import { getStore } from "@netlify/blobs";
import jwt from "jsonwebtoken";
import { processImage } from "./media-processor.mts";

// ═══════════════════════════════════════════════════════════════
// CONTENT PIPELINE — Upload, Process, Queue, Approve, Publish
// ═══════════════════════════════════════════════════════════════
// Pipeline states: inbox → processed → queued → published
//                                    ↘ rejected

const CORS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
};

// ─── Config & Auth Helpers ──────────────────────────────────

function getSecret() {
    return process.env.JWT_SECRET || "inkedmayhem-dev-secret-change-me";
}

function verifyAdmin(req: Request) {
    const auth = req.headers.get("authorization");
    if (!auth) return null;
    try {
        const token = auth.replace("Bearer ", "");
        const decoded = jwt.verify(token, getSecret()) as any;
        if (!decoded.isAdmin) return null;
        return decoded;
    } catch { return null; }
}

function getCreatorConfig() {
    // In multi-creator mode this would be per-creator
    // For now returns the default InkedMayhem config
    return {
        allowedFileTypes: ["jpg", "jpeg", "png", "webp", "mp4", "mov"],
        maxImageSizeMB: 25,
        maxVideoSizeMB: 500,
        stripExif: true,
        compressImages: true,
        generateThumbnails: true,
        explicitAllowed: false,
        categories: ["photos", "selfies", "lifestyle", "behind-the-scenes"],
        moderationLevel: "manual", // manual | trusted | scheduled
        autoApproveAfterChecks: false
    };
}

// ─── Validation & Processing ────────────────────────────────

const IMAGE_TYPES = ["jpg", "jpeg", "png", "webp", "gif"];
const VIDEO_TYPES = ["mp4", "mov", "webm", "avi"];

function getFileExtension(filename: string): string {
    return (filename.split(".").pop() || "").toLowerCase();
}

function isImage(ext: string): boolean {
    return IMAGE_TYPES.includes(ext);
}

function isVideo(ext: string): boolean {
    return VIDEO_TYPES.includes(ext);
}

function validateFile(filename: string, sizeBytes: number, config: ReturnType<typeof getCreatorConfig>) {
    const ext = getFileExtension(filename);
    const checks = {
        fileTypeValid: false,
        fileSizeValid: false,
        exifStripped: false,
        compressed: false,
        thumbnailGenerated: false,
        errors: [] as string[]
    };

    // Check file type
    if (config.allowedFileTypes.includes(ext)) {
        checks.fileTypeValid = true;
    } else {
        checks.errors.push(`File type .${ext} not allowed. Allowed: ${config.allowedFileTypes.join(", ")}`);
    }

    // Check file size
    const sizeMB = sizeBytes / (1024 * 1024);
    const maxMB = isImage(ext) ? config.maxImageSizeMB : config.maxVideoSizeMB;
    if (sizeMB <= maxMB) {
        checks.fileSizeValid = true;
    } else {
        checks.errors.push(`File size ${sizeMB.toFixed(1)}MB exceeds max ${maxMB}MB`);
    }

    // EXIF stripping happens server-side after upload
    // For now mark as pending (will be done in processing step)
    if (config.stripExif) {
        checks.exifStripped = false; // Will be set to true after processing
    } else {
        checks.exifStripped = true; // Not required
    }

    // Compression and thumbnails are also post-upload processing
    checks.compressed = false;
    checks.thumbnailGenerated = false;

    return checks;
}

function generatePipelineId(): string {
    return `pipe-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
}

// ─── Notification Helper ────────────────────────────────────

async function notifyAdmin(type: string, data: Record<string, any>) {
    try {
        const siteUrl = process.env.URL || "http://localhost:8888";
        await fetch(`${siteUrl}/api/notify`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-internal-key": getSecret()
            },
            body: JSON.stringify({ type, data })
        });
    } catch (err) {
        console.error("[PIPELINE] Notification failed:", err);
    }
}

// ─── Pipeline Log Helper ────────────────────────────────────

async function logPipelineEvent(action: string, itemId: string, details: Record<string, any> = {}) {
    try {
        const store = getStore("pipeline-logs");
        const logKey = `log-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        await store.setJSON(logKey, {
            action,
            itemId,
            details,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error("[PIPELINE] Log write failed:", err);
    }
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════

export default async (req: Request, context: any) => {
    if (req.method === "OPTIONS") {
        return new Response("", { headers: CORS });
    }

    const url = new URL(req.url);
    const path = url.pathname.replace("/api/pipeline", "").replace(/\/$/, "") || "";

    // ─── INGEST: Accept new content into pipeline ───────────
    // POST /api/pipeline/ingest
    // Body: { filename, fileSize, fileData (base64), caption?, tags?, category?, tier?, source? }
    if (path === "/ingest" && req.method === "POST") {
        const admin = verifyAdmin(req);
        // Allow admin uploads and webhook-based uploads (with API key)
        const apiKey = req.headers.get("x-api-key");
        const expectedApiKey = process.env.PIPELINE_API_KEY || getSecret();
        const isAuthorized = admin || apiKey === expectedApiKey;

        if (!isAuthorized) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }

        try {
            const body = await req.json();
            const { filename, fileSize, fileData, caption, tags, category, tier, source, creatorId } = body;

            if (!filename || !fileSize) {
                return new Response(JSON.stringify({ error: "filename and fileSize required" }), { status: 400, headers: CORS });
            }

            const config = getCreatorConfig();
            const checks = validateFile(filename, fileSize, config);

            if (!checks.fileTypeValid || !checks.fileSizeValid) {
                return new Response(JSON.stringify({
                    error: "File validation failed",
                    checks,
                    errors: checks.errors
                }), { status: 400, headers: CORS });
            }

            const pipelineId = generatePipelineId();
            const ext = getFileExtension(filename);
            const mediaType = isImage(ext) ? "image" : isVideo(ext) ? "video" : "other";

            // Store the file data in blob storage
            if (fileData) {
                const assetStore = getStore("pipeline-assets");
                await assetStore.set(`${pipelineId}.${ext}`, fileData);
            }

            // Create pipeline item
            const pipelineStore = getStore("pipeline");
            const item = {
                id: pipelineId,
                creatorId: creatorId || "inkedmayhem",
                status: "inbox",
                filename,
                storedAs: `${pipelineId}.${ext}`,
                mediaType,
                fileExtension: ext,
                fileSize,
                fileSizeMB: (fileSize / (1024 * 1024)).toFixed(2),
                caption: caption || "",
                tags: tags || [],
                category: category || "photos",
                tier: tier || "free",
                source: source || "upload",
                checks: {
                    fileTypeValid: checks.fileTypeValid,
                    fileSizeValid: checks.fileSizeValid,
                    exifStripped: false,
                    compressed: false,
                    thumbnailGenerated: false
                },
                rejectReason: "",
                scheduledAt: null,
                publishedAt: null,
                createdAt: new Date().toISOString(),
                processedAt: null,
                queuedAt: null
            };

            await pipelineStore.setJSON(pipelineId, item);
            await logPipelineEvent("ingest", pipelineId, { filename, source: item.source, fileSize });

            // Notify admin of new content
            if (config.moderationLevel === "manual") {
                await notifyAdmin("pipeline_ingest", {
                    filename,
                    source: item.source,
                    pipelineId
                });
            }

            return new Response(JSON.stringify({
                success: true,
                pipelineId,
                status: "inbox",
                checks: item.checks
            }), { headers: CORS });

        } catch (err) {
            console.error("[PIPELINE] Ingest error:", err);
            return new Response(JSON.stringify({ error: "Ingest failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── PROCESS: Run automated checks ──────────────────────
    // POST /api/pipeline/process
    // Body: { pipelineId }
    if (path === "/process" && req.method === "POST") {
        if (!verifyAdmin(req)) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }

        try {
            const { pipelineId } = await req.json();
            if (!pipelineId) {
                return new Response(JSON.stringify({ error: "pipelineId required" }), { status: 400, headers: CORS });
            }

            const store = getStore("pipeline");
            const item = await store.get(pipelineId, { type: "json" }) as any;
            if (!item) {
                return new Response(JSON.stringify({ error: "Item not found" }), { status: 404, headers: CORS });
            }

            if (item.status !== "inbox") {
                return new Response(JSON.stringify({ error: `Cannot process item in '${item.status}' state` }), { status: 400, headers: CORS });
            }

            // Run actual processing steps via Sharp
            const config = getCreatorConfig();

            // For images: real EXIF strip, compression, thumbnail generation
            if (item.mediaType === "image" && item.storedAs) {
                try {
                    // Load creator-specific watermark settings
                    let watermarkText = "";
                    let doWatermark = false;
                    try {
                        const creatorStore = getStore("creator-configs");
                        const creatorCfg = await creatorStore.get(item.creatorId || "inkedmayhem", { type: "json" }) as any;
                        if (creatorCfg?.content?.autoWatermark) {
                            doWatermark = true;
                            watermarkText = creatorCfg?.brand?.name || "InkedMayhem";
                        }
                    } catch {}

                    const processingResult = await processImage(item.storedAs, {
                        stripExif: config.stripExif,
                        compress: config.compressImages,
                        generateThumbnail: config.generateThumbnails,
                        watermark: doWatermark,
                        watermarkText
                    });

                    item.checks.exifStripped = processingResult.exifStripped;
                    item.checks.compressed = processingResult.compressed;
                    item.checks.thumbnailGenerated = processingResult.thumbnailGenerated;
                    item.processing = {
                        originalSizeBytes: processingResult.originalSizeBytes,
                        processedSizeBytes: processingResult.processedSizeBytes,
                        thumbnailSizeBytes: processingResult.thumbnailSizeBytes,
                        savings: processingResult.originalSizeBytes > 0
                            ? `${Math.round((1 - processingResult.processedSizeBytes / processingResult.originalSizeBytes) * 100)}%`
                            : "0%",
                        format: processingResult.format,
                        width: processingResult.width,
                        height: processingResult.height,
                        watermarked: processingResult.watermarked,
                        errors: processingResult.errors
                    };

                    if (processingResult.errors.length > 0) {
                        console.warn("[PIPELINE] Processing warnings:", processingResult.errors);
                    }
                } catch (procErr: any) {
                    console.error("[PIPELINE] Sharp processing failed, marking as manual:", procErr);
                    // Fallback: mark checks based on config (graceful degradation)
                    item.checks.exifStripped = false;
                    item.checks.compressed = false;
                    item.checks.thumbnailGenerated = false;
                    item.processing = { errors: [procErr.message || "Processing failed"] };
                }
            } else {
                // Video or other: mark config-based (real video processing needs FFmpeg)
                item.checks.exifStripped = true; // Videos don't have EXIF in the same way
                item.checks.compressed = false; // Would need FFmpeg
                item.checks.thumbnailGenerated = false; // Would need FFmpeg
                item.processing = { note: "Video processing requires FFmpeg — skipped" };
            }

            item.status = "processed";
            item.processedAt = new Date().toISOString();

            await store.setJSON(pipelineId, item);
            await logPipelineEvent("process", pipelineId, {
                checks: item.checks,
                processing: item.processing
            });

            // If auto-approve is on (Tier B creators), move to queued
            if (config.autoApproveAfterChecks) {
                item.status = "queued";
                item.queuedAt = new Date().toISOString();
                await store.setJSON(pipelineId, item);
                await logPipelineEvent("auto-queue", pipelineId, {});
            }

            return new Response(JSON.stringify({
                success: true,
                pipelineId,
                status: item.status,
                checks: item.checks,
                processing: item.processing
            }), { headers: CORS });

        } catch (err) {
            console.error("[PIPELINE] Process error:", err);
            return new Response(JSON.stringify({ error: "Processing failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── PROCESS ALL: Batch process all inbox items ─────────
    // POST /api/pipeline/process-all
    if (path === "/process-all" && req.method === "POST") {
        if (!verifyAdmin(req)) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }

        try {
            const store = getStore("pipeline");
            const { blobs } = await store.list();
            const config = getCreatorConfig();
            let processed = 0;

            for (const blob of blobs) {
                const item = await store.get(blob.key, { type: "json" }) as any;
                if (item && item.status === "inbox") {
                    // Real image processing via Sharp
                    if (item.mediaType === "image" && item.storedAs) {
                        try {
                            const procResult = await processImage(item.storedAs, {
                                stripExif: config.stripExif,
                                compress: config.compressImages,
                                generateThumbnail: config.generateThumbnails
                            });
                            item.checks.exifStripped = procResult.exifStripped;
                            item.checks.compressed = procResult.compressed;
                            item.checks.thumbnailGenerated = procResult.thumbnailGenerated;
                            item.processing = {
                                originalSizeBytes: procResult.originalSizeBytes,
                                processedSizeBytes: procResult.processedSizeBytes,
                                savings: procResult.originalSizeBytes > 0
                                    ? `${Math.round((1 - procResult.processedSizeBytes / procResult.originalSizeBytes) * 100)}%`
                                    : "0%",
                                errors: procResult.errors
                            };
                        } catch (procErr: any) {
                            item.checks.exifStripped = false;
                            item.checks.compressed = false;
                            item.checks.thumbnailGenerated = false;
                            item.processing = { errors: [procErr.message || "Processing failed"] };
                        }
                    } else {
                        item.checks.exifStripped = true;
                        item.checks.compressed = false;
                        item.checks.thumbnailGenerated = false;
                    }

                    item.status = "processed";
                    item.processedAt = new Date().toISOString();

                    if (config.autoApproveAfterChecks) {
                        item.status = "queued";
                        item.queuedAt = new Date().toISOString();
                    }

                    await store.setJSON(blob.key, item);
                    processed++;
                }
            }

            await logPipelineEvent("process-all", "batch", { processed });
            return new Response(JSON.stringify({ success: true, processed }), { headers: CORS });

        } catch (err) {
            return new Response(JSON.stringify({ error: "Batch processing failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── APPROVE: Move to queue ─────────────────────────────
    // POST /api/pipeline/approve
    // Body: { pipelineId, caption?, tags?, category?, tier?, scheduledAt? }
    if (path === "/approve" && req.method === "POST") {
        if (!verifyAdmin(req)) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }

        try {
            const { pipelineId, caption, tags, category, tier, scheduledAt } = await req.json();
            if (!pipelineId) {
                return new Response(JSON.stringify({ error: "pipelineId required" }), { status: 400, headers: CORS });
            }

            const store = getStore("pipeline");
            const item = await store.get(pipelineId, { type: "json" }) as any;
            if (!item) {
                return new Response(JSON.stringify({ error: "Item not found" }), { status: 404, headers: CORS });
            }

            if (item.status !== "processed" && item.status !== "inbox") {
                return new Response(JSON.stringify({ error: `Cannot approve item in '${item.status}' state` }), { status: 400, headers: CORS });
            }

            // Update fields if provided
            if (caption !== undefined) item.caption = caption;
            if (tags) item.tags = tags;
            if (category) item.category = category;
            if (tier) item.tier = tier;
            if (scheduledAt) item.scheduledAt = scheduledAt;

            item.status = "queued";
            item.queuedAt = new Date().toISOString();

            // If item was in inbox (not yet processed), run real processing
            if (!item.processedAt) {
                if (item.mediaType === "image" && item.storedAs) {
                    try {
                        const config = getCreatorConfig();
                        const procResult = await processImage(item.storedAs, {
                            stripExif: config.stripExif,
                            compress: config.compressImages,
                            generateThumbnail: config.generateThumbnails
                        });
                        item.checks.exifStripped = procResult.exifStripped;
                        item.checks.compressed = procResult.compressed;
                        item.checks.thumbnailGenerated = procResult.thumbnailGenerated;
                    } catch {
                        // Graceful fallback
                        item.checks.exifStripped = false;
                        item.checks.compressed = false;
                        item.checks.thumbnailGenerated = false;
                    }
                }
                item.processedAt = new Date().toISOString();
            }

            await store.setJSON(pipelineId, item);
            await logPipelineEvent("approve", pipelineId, { tier: item.tier, scheduledAt: item.scheduledAt });

            return new Response(JSON.stringify({ success: true, status: "queued" }), { headers: CORS });

        } catch (err) {
            return new Response(JSON.stringify({ error: "Approve failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── REJECT: Reject content ─────────────────────────────
    // POST /api/pipeline/reject
    // Body: { pipelineId, reason? }
    if (path === "/reject" && req.method === "POST") {
        if (!verifyAdmin(req)) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }

        try {
            const { pipelineId, reason } = await req.json();
            if (!pipelineId) {
                return new Response(JSON.stringify({ error: "pipelineId required" }), { status: 400, headers: CORS });
            }

            const store = getStore("pipeline");
            const item = await store.get(pipelineId, { type: "json" }) as any;
            if (!item) {
                return new Response(JSON.stringify({ error: "Item not found" }), { status: 404, headers: CORS });
            }

            item.status = "rejected";
            item.rejectReason = reason || "Rejected by admin";

            await store.setJSON(pipelineId, item);
            await logPipelineEvent("reject", pipelineId, { reason: item.rejectReason });

            return new Response(JSON.stringify({ success: true, status: "rejected" }), { headers: CORS });

        } catch (err) {
            return new Response(JSON.stringify({ error: "Reject failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── PUBLISH: Publish queued content to the site ────────
    // POST /api/pipeline/publish
    // Body: { pipelineId }
    if (path === "/publish" && req.method === "POST") {
        if (!verifyAdmin(req)) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }

        try {
            const { pipelineId } = await req.json();
            if (!pipelineId) {
                return new Response(JSON.stringify({ error: "pipelineId required" }), { status: 400, headers: CORS });
            }

            const pipeStore = getStore("pipeline");
            const item = await pipeStore.get(pipelineId, { type: "json" }) as any;
            if (!item) {
                return new Response(JSON.stringify({ error: "Item not found" }), { status: 404, headers: CORS });
            }

            if (item.status !== "queued") {
                return new Response(JSON.stringify({ error: `Cannot publish item in '${item.status}' state` }), { status: 400, headers: CORS });
            }

            // Create a content entry in the main content store
            const contentStore = getStore("content");
            const contentKey = `content-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

            // Retrieve the stored asset URL (in production this would be a CDN URL)
            const assetStore = getStore("pipeline-assets");
            let assetUrl = "";
            try {
                // Check if asset exists
                const assetData = await assetStore.get(item.storedAs);
                if (assetData) {
                    // In a real setup, this would be uploaded to S3/R2 and we'd get a CDN URL
                    // For now, store as a data reference
                    assetUrl = `/api/pipeline/asset/${item.storedAs}`;
                }
            } catch {}

            const contentItem = {
                title: item.caption || item.filename,
                body: item.caption || "",
                tier: item.tier || "free",
                type: item.mediaType === "video" ? "video" : "gallery",
                imageUrl: assetUrl,
                draft: false,
                tags: item.tags || [],
                category: item.category || "photos",
                source: item.source,
                pipelineId: item.id,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            await contentStore.setJSON(contentKey, contentItem);

            // Update pipeline item
            item.status = "published";
            item.publishedAt = new Date().toISOString();
            item.contentKey = contentKey;
            await pipeStore.setJSON(pipelineId, item);

            await logPipelineEvent("publish", pipelineId, { contentKey });

            // Notify admin
            await notifyAdmin("pipeline_publish", {
                filename: item.filename,
                contentKey,
                tier: item.tier
            });

            // Notify subscribers of new content drop
            if (item.tier === "free" || item.tier === "vip" || item.tier === "elite") {
                notifyAdmin("content_drop", {
                    title: contentItem.title,
                    category: item.category,
                    tier: item.tier
                });
            }

            return new Response(JSON.stringify({
                success: true,
                status: "published",
                contentKey
            }), { headers: CORS });

        } catch (err) {
            console.error("[PIPELINE] Publish error:", err);
            return new Response(JSON.stringify({ error: "Publish failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── BULK PUBLISH: Publish all queued items ─────────────
    // POST /api/pipeline/publish-all
    if (path === "/publish-all" && req.method === "POST") {
        if (!verifyAdmin(req)) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }

        try {
            const pipeStore = getStore("pipeline");
            const contentStore = getStore("content");
            const { blobs } = await pipeStore.list();
            let published = 0;

            for (const blob of blobs) {
                const item = await pipeStore.get(blob.key, { type: "json" }) as any;
                if (item && item.status === "queued") {
                    const contentKey = `content-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

                    const contentItem = {
                        title: item.caption || item.filename,
                        body: item.caption || "",
                        tier: item.tier || "free",
                        type: item.mediaType === "video" ? "video" : "gallery",
                        imageUrl: `/api/pipeline/asset/${item.storedAs}`,
                        draft: false,
                        tags: item.tags || [],
                        category: item.category || "photos",
                        source: item.source,
                        pipelineId: item.id,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    };

                    await contentStore.setJSON(contentKey, contentItem);

                    item.status = "published";
                    item.publishedAt = new Date().toISOString();
                    item.contentKey = contentKey;
                    await pipeStore.setJSON(blob.key, item);
                    published++;
                }
            }

            await logPipelineEvent("publish-all", "batch", { published });
            return new Response(JSON.stringify({ success: true, published }), { headers: CORS });

        } catch (err) {
            return new Response(JSON.stringify({ error: "Bulk publish failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── LIST: Get pipeline items by status ─────────────────
    // GET /api/pipeline/list?status=inbox|processed|queued|published|rejected|all
    if (path === "/list" && req.method === "GET") {
        if (!verifyAdmin(req)) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }

        try {
            const statusFilter = url.searchParams.get("status") || "all";
            const store = getStore("pipeline");
            const { blobs } = await store.list();
            const items: any[] = [];

            for (const blob of blobs) {
                try {
                    const item = await store.get(blob.key, { type: "json" }) as any;
                    if (item) {
                        if (statusFilter === "all" || item.status === statusFilter) {
                            items.push(item);
                        }
                    }
                } catch {}
            }

            // Sort by creation date descending
            items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

            // Compute counts per status
            const allItems = items.length;
            const counts: Record<string, number> = {};
            if (statusFilter === "all") {
                for (const item of items) {
                    counts[item.status] = (counts[item.status] || 0) + 1;
                }
            }

            return new Response(JSON.stringify({
                success: true,
                items,
                total: allItems,
                counts
            }), { headers: CORS });

        } catch (err) {
            return new Response(JSON.stringify({ error: "List failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── STATS: Pipeline overview stats ─────────────────────
    // GET /api/pipeline/stats
    if (path === "/stats" && req.method === "GET") {
        if (!verifyAdmin(req)) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }

        try {
            const store = getStore("pipeline");
            const { blobs } = await store.list();
            const counts = { inbox: 0, processed: 0, queued: 0, published: 0, rejected: 0, total: 0 };

            for (const blob of blobs) {
                try {
                    const item = await store.get(blob.key, { type: "json" }) as any;
                    if (item?.status) {
                        counts[item.status as keyof typeof counts] = (counts[item.status as keyof typeof counts] || 0) + 1;
                        counts.total++;
                    }
                } catch {}
            }

            // Get recent logs
            const logStore = getStore("pipeline-logs");
            const logBlobs = await logStore.list();
            const recentLogs: any[] = [];
            const logKeys = logBlobs.blobs.slice(-20); // Last 20 logs
            for (const blob of logKeys) {
                try {
                    const log = await logStore.get(blob.key, { type: "json" });
                    if (log) recentLogs.push(log);
                } catch {}
            }
            recentLogs.sort((a: any, b: any) => (b.timestamp || "").localeCompare(a.timestamp || ""));

            return new Response(JSON.stringify({
                success: true,
                pipeline: counts,
                recentActivity: recentLogs.slice(0, 10)
            }), { headers: CORS });

        } catch (err) {
            return new Response(JSON.stringify({ error: "Stats failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── GET SINGLE ITEM ────────────────────────────────────
    // GET /api/pipeline/item?id=pipe-xxx
    if (path === "/item" && req.method === "GET") {
        if (!verifyAdmin(req)) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }

        try {
            const itemId = url.searchParams.get("id");
            if (!itemId) {
                return new Response(JSON.stringify({ error: "id required" }), { status: 400, headers: CORS });
            }

            const store = getStore("pipeline");
            const item = await store.get(itemId, { type: "json" });
            if (!item) {
                return new Response(JSON.stringify({ error: "Item not found" }), { status: 404, headers: CORS });
            }

            return new Response(JSON.stringify({ success: true, item }), { headers: CORS });

        } catch (err) {
            return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── UPDATE ITEM METADATA ───────────────────────────────
    // POST /api/pipeline/update
    // Body: { pipelineId, caption?, tags?, category?, tier?, scheduledAt? }
    if (path === "/update" && req.method === "POST") {
        if (!verifyAdmin(req)) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }

        try {
            const { pipelineId, caption, tags, category, tier, scheduledAt } = await req.json();
            if (!pipelineId) {
                return new Response(JSON.stringify({ error: "pipelineId required" }), { status: 400, headers: CORS });
            }

            const store = getStore("pipeline");
            const item = await store.get(pipelineId, { type: "json" }) as any;
            if (!item) {
                return new Response(JSON.stringify({ error: "Item not found" }), { status: 404, headers: CORS });
            }

            if (caption !== undefined) item.caption = caption;
            if (tags !== undefined) item.tags = tags;
            if (category !== undefined) item.category = category;
            if (tier !== undefined) item.tier = tier;
            if (scheduledAt !== undefined) item.scheduledAt = scheduledAt;

            await store.setJSON(pipelineId, item);
            await logPipelineEvent("update", pipelineId, { caption, tags, category, tier });

            return new Response(JSON.stringify({ success: true, item }), { headers: CORS });

        } catch (err) {
            return new Response(JSON.stringify({ error: "Update failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── DELETE: Remove pipeline item ───────────────────────
    // POST /api/pipeline/delete
    // Body: { pipelineId }
    if (path === "/delete" && req.method === "POST") {
        if (!verifyAdmin(req)) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }

        try {
            const { pipelineId } = await req.json();
            if (!pipelineId) {
                return new Response(JSON.stringify({ error: "pipelineId required" }), { status: 400, headers: CORS });
            }

            const store = getStore("pipeline");
            const item = await store.get(pipelineId, { type: "json" }) as any;

            // Also delete the stored asset + processed version + thumbnail
            if (item?.storedAs) {
                try {
                    const assetStore = getStore("pipeline-assets");
                    await assetStore.delete(item.storedAs);
                    // Clean up processed and thumbnail variants
                    const baseName = item.storedAs.replace(/\.[^.]+$/, "");
                    const variants = [
                        `${baseName}-processed.webp`,
                        `${baseName}-processed.jpg`,
                        `${baseName}-processed.png`,
                        `${baseName}-thumb.webp`
                    ];
                    for (const v of variants) {
                        try { await assetStore.delete(v); } catch {}
                    }
                } catch {}
            }

            await store.delete(pipelineId);
            await logPipelineEvent("delete", pipelineId, {});

            return new Response(JSON.stringify({ success: true }), { headers: CORS });

        } catch (err) {
            return new Response(JSON.stringify({ error: "Delete failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── SERVE ASSET ────────────────────────────────────────
    // GET /api/pipeline/asset/:filename
    if (path.startsWith("/asset/") && req.method === "GET") {
        try {
            const assetKey = path.replace("/asset/", "");
            const assetStore = getStore("pipeline-assets");
            const data = await assetStore.get(assetKey);

            if (!data) {
                return new Response("Not found", { status: 404 });
            }

            // Determine content type from extension
            const ext = assetKey.split(".").pop()?.toLowerCase() || "";
            const contentTypes: Record<string, string> = {
                jpg: "image/jpeg",
                jpeg: "image/jpeg",
                png: "image/png",
                webp: "image/webp",
                gif: "image/gif",
                mp4: "video/mp4",
                mov: "video/quicktime",
                webm: "video/webm"
            };

            return new Response(data, {
                headers: {
                    "Content-Type": contentTypes[ext] || "application/octet-stream",
                    "Cache-Control": "public, max-age=31536000",
                    "Access-Control-Allow-Origin": "*"
                }
            });

        } catch (err) {
            return new Response("Asset not found", { status: 404 });
        }
    }

    // ─── SERVE THUMBNAIL ──────────────────────────────────
    // GET /api/pipeline/thumb/:filename — auto-resolves to {base}-thumb.webp
    if (path.startsWith("/thumb/") && req.method === "GET") {
        try {
            const assetKey = path.replace("/thumb/", "");
            const baseName = assetKey.replace(/\.[^.]+$/, "");
            const thumbKey = `${baseName}-thumb.webp`;
            const assetStore = getStore("pipeline-assets");
            const data = await assetStore.get(thumbKey);

            if (!data) {
                // Fall back to original asset if no thumbnail exists
                const original = await assetStore.get(assetKey);
                if (!original) return new Response("Not found", { status: 404 });
                const ext = assetKey.split(".").pop()?.toLowerCase() || "";
                const ct: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
                return new Response(original, {
                    headers: { "Content-Type": ct[ext] || "image/jpeg", "Cache-Control": "public, max-age=31536000", "Access-Control-Allow-Origin": "*" }
                });
            }

            return new Response(data, {
                headers: {
                    "Content-Type": "image/webp",
                    "Cache-Control": "public, max-age=31536000",
                    "Access-Control-Allow-Origin": "*"
                }
            });
        } catch (err) {
            return new Response("Thumbnail not found", { status: 404 });
        }
    }

    // ─── LOGS: Get pipeline activity logs ───────────────────
    // GET /api/pipeline/logs?limit=50
    if (path === "/logs" && req.method === "GET") {
        if (!verifyAdmin(req)) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }

        try {
            const limit = parseInt(url.searchParams.get("limit") || "50");
            const logStore = getStore("pipeline-logs");
            const { blobs } = await logStore.list();
            const logs: any[] = [];

            for (const blob of blobs) {
                try {
                    const log = await logStore.get(blob.key, { type: "json" });
                    if (log) logs.push(log);
                } catch {}
            }

            logs.sort((a: any, b: any) => (b.timestamp || "").localeCompare(a.timestamp || ""));

            return new Response(JSON.stringify({
                success: true,
                logs: logs.slice(0, limit),
                total: logs.length
            }), { headers: CORS });

        } catch (err) {
            return new Response(JSON.stringify({ error: "Logs failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── SCHEDULE CHECK: Process scheduled items ────────────
    // POST /api/pipeline/check-schedule
    // Called periodically (cron or manual) to publish items whose scheduledAt has passed
    if (path === "/check-schedule" && req.method === "POST") {
        const admin = verifyAdmin(req);
        const apiKey = req.headers.get("x-api-key");
        const expectedApiKey = process.env.PIPELINE_API_KEY || getSecret();
        if (!admin && apiKey !== expectedApiKey) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }

        try {
            const now = new Date().toISOString();
            const pipeStore = getStore("pipeline");
            const contentStore = getStore("content");
            const { blobs } = await pipeStore.list();
            let published = 0;

            for (const blob of blobs) {
                const item = await pipeStore.get(blob.key, { type: "json" }) as any;
                if (item && item.status === "queued" && item.scheduledAt && item.scheduledAt <= now) {
                    const contentKey = `content-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
                    const contentItem = {
                        title: item.caption || item.filename,
                        body: item.caption || "",
                        tier: item.tier || "free",
                        type: item.mediaType === "video" ? "video" : "gallery",
                        imageUrl: `/api/pipeline/asset/${item.storedAs}`,
                        draft: false,
                        tags: item.tags || [],
                        category: item.category || "photos",
                        source: item.source,
                        pipelineId: item.id,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    };

                    await contentStore.setJSON(contentKey, contentItem);
                    item.status = "published";
                    item.publishedAt = new Date().toISOString();
                    item.contentKey = contentKey;
                    await pipeStore.setJSON(blob.key, item);
                    published++;
                }
            }

            await logPipelineEvent("schedule-check", "cron", { published, checkedAt: now });
            return new Response(JSON.stringify({ success: true, published }), { headers: CORS });

        } catch (err) {
            return new Response(JSON.stringify({ error: "Schedule check failed" }), { status: 500, headers: CORS });
        }
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
};

export const config = {
    path: ["/api/pipeline", "/api/pipeline/*"]
};
