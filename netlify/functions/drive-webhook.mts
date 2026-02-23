import { getStore } from "./lib/blobs.mjs";

// ═══════════════════════════════════════════════════════════════
// DRIVE / DROPBOX WEBHOOK — Content intake from cloud storage
// ═══════════════════════════════════════════════════════════════
// Receives webhook notifications when files are added to shared folders.
// Supports Google Drive push notifications and Dropbox webhooks.
//
// Setup:
// 1. Google Drive: Use Drive API push notifications to this endpoint
// 2. Dropbox: Set this URL as a Dropbox webhook endpoint
// 3. Generic: POST files directly with API key auth

const CORS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key, X-Goog-Channel-ID, X-Goog-Resource-State",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function getSecret() {
    return process.env.JWT_SECRET || "inkedmayhem-dev-secret-change-me";
}

function getPipelineApiKey() {
    return process.env.PIPELINE_API_KEY || getSecret();
}

// ─── Supported file types ───────────────────────────────────

const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "mp4", "mov", "webm"];
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"];

function getExtension(filename: string): string {
    return (filename.split(".").pop() || "").toLowerCase();
}

function isAllowedFile(filename: string): boolean {
    return ALLOWED_EXTENSIONS.includes(getExtension(filename));
}

// ─── Pipeline Item Creator ──────────────────────────────────

async function createPipelineItem(params: {
    filename: string;
    fileSize: number;
    fileData?: string;
    source: string;
    sourceId?: string;
    caption?: string;
    creatorId?: string;
}) {
    const pipeStore = getStore("pipeline");
    const logStore = getStore("pipeline-logs");
    const ext = getExtension(params.filename);
    const pipelineId = `pipe-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;

    // Store file data if provided
    if (params.fileData) {
        const assetStore = getStore("pipeline-assets");
        await assetStore.set(`${pipelineId}.${ext}`, params.fileData);
    }

    const item = {
        id: pipelineId,
        creatorId: params.creatorId || "inkedmayhem",
        status: "inbox",
        filename: params.filename,
        storedAs: `${pipelineId}.${ext}`,
        mediaType: IMAGE_EXTENSIONS.includes(ext) ? "image" : "video",
        fileExtension: ext,
        fileSize: params.fileSize,
        fileSizeMB: (params.fileSize / (1024 * 1024)).toFixed(2),
        caption: params.caption || "",
        tags: [],
        category: "photos",
        tier: "free",
        source: params.source,
        sourceId: params.sourceId || "",
        checks: {
            fileTypeValid: true,
            fileSizeValid: params.fileSize < 25 * 1024 * 1024, // 25MB for images
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

    await pipeStore.setJSON(pipelineId, item);

    // Log
    await logStore.setJSON(`log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`, {
        action: `${params.source}-upload`,
        itemId: pipelineId,
        details: { filename: params.filename, source: params.source },
        timestamp: new Date().toISOString()
    });

    // Notify admin via Telegram
    try {
        const botToken = process.env.TELEGRAM_CREATOR_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CREATOR_CHAT_ID;
        if (botToken && chatId) {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: `📥 <b>New upload from ${params.source}</b>\n\n📁 ${params.filename}\n📂 Added to inbox`,
                    parse_mode: "HTML"
                })
            });
        }
    } catch {}

    return { pipelineId, item };
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════

export default async (req: Request, context: any) => {
    if (req.method === "OPTIONS") {
        return new Response("", { headers: CORS });
    }

    const url = new URL(req.url);
    const path = url.pathname.replace("/api/drive-webhook", "").replace(/\/$/, "") || "";

    // ─── DROPBOX WEBHOOK VERIFICATION ───────────────────────
    // Dropbox sends a GET request with a challenge parameter to verify the endpoint
    if (req.method === "GET" && path === "") {
        const challenge = url.searchParams.get("challenge");
        if (challenge) {
            return new Response(challenge, {
                headers: {
                    "Content-Type": "text/plain",
                    "X-Content-Type-Options": "nosniff"
                }
            });
        }
        return new Response(JSON.stringify({ status: "Drive webhook endpoint ready" }), { headers: CORS });
    }

    // ─── GOOGLE DRIVE PUSH NOTIFICATION ─────────────────────
    // Google Drive sends push notifications with resource state headers
    if (path === "/google" && req.method === "POST") {
        const resourceState = req.headers.get("x-goog-resource-state");
        const channelId = req.headers.get("x-goog-channel-id");

        console.log(`[DRIVE-WEBHOOK] Google notification: state=${resourceState}, channel=${channelId}`);

        // sync = initial verification, just acknowledge
        if (resourceState === "sync") {
            return new Response(JSON.stringify({ ok: true }), { headers: CORS });
        }

        // For actual changes, we'd need to use the Drive API to list new files
        // This requires a Google API service account token
        // For now, log the event and notify admin
        if (resourceState === "change" || resourceState === "update") {
            try {
                const logStore = getStore("pipeline-logs");
                await logStore.setJSON(`log-${Date.now()}-gdrive`, {
                    action: "google-drive-notification",
                    itemId: channelId || "unknown",
                    details: { resourceState, channelId },
                    timestamp: new Date().toISOString()
                });

                // Notify admin that new files may be available
                const botToken = process.env.TELEGRAM_CREATOR_BOT_TOKEN;
                const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CREATOR_CHAT_ID;
                if (botToken && chatId) {
                    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            chat_id: chatId,
                            text: `📁 <b>Google Drive Update</b>\n\nNew files detected in the shared folder. Check the drive and upload to pipeline.`,
                            parse_mode: "HTML"
                        })
                    });
                }
            } catch (err) {
                console.error("[DRIVE-WEBHOOK] Google notification error:", err);
            }
        }

        return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    // ─── DROPBOX WEBHOOK ────────────────────────────────────
    // Dropbox sends POST with list of changed accounts
    if (path === "/dropbox" && req.method === "POST") {
        try {
            const body = await req.json() as any;
            const accounts = body.list_folder?.accounts || [];

            console.log(`[DRIVE-WEBHOOK] Dropbox notification: ${accounts.length} accounts changed`);

            const logStore = getStore("pipeline-logs");
            await logStore.setJSON(`log-${Date.now()}-dropbox`, {
                action: "dropbox-notification",
                itemId: "dropbox",
                details: { accountCount: accounts.length },
                timestamp: new Date().toISOString()
            });

            // Notify admin
            const botToken = process.env.TELEGRAM_CREATOR_BOT_TOKEN;
            const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CREATOR_CHAT_ID;
            if (botToken && chatId) {
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: `📁 <b>Dropbox Update</b>\n\nNew files detected in the shared folder. Check Dropbox and upload to pipeline.`,
                        parse_mode: "HTML"
                    })
                });
            }

            return new Response(JSON.stringify({ ok: true }), { headers: CORS });
        } catch (err) {
            console.error("[DRIVE-WEBHOOK] Dropbox error:", err);
            return new Response(JSON.stringify({ ok: true }), { headers: CORS });
        }
    }

    // ─── GENERIC FILE UPLOAD (API key auth) ─────────────────
    // POST /api/drive-webhook/upload
    // Body: { filename, fileSize, fileData (base64), source?, caption?, creatorId? }
    // Auth: x-api-key header
    if (path === "/upload" && req.method === "POST") {
        const apiKey = req.headers.get("x-api-key");
        if (apiKey !== getPipelineApiKey()) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }

        try {
            const body = await req.json();
            const { filename, fileSize, fileData, source, caption, creatorId } = body;

            if (!filename || !fileSize) {
                return new Response(JSON.stringify({ error: "filename and fileSize required" }), { status: 400, headers: CORS });
            }

            if (!isAllowedFile(filename)) {
                return new Response(JSON.stringify({
                    error: `File type not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`
                }), { status: 400, headers: CORS });
            }

            const result = await createPipelineItem({
                filename,
                fileSize,
                fileData,
                source: source || "api",
                caption,
                creatorId
            });

            return new Response(JSON.stringify({
                success: true,
                pipelineId: result.pipelineId,
                status: "inbox"
            }), { headers: CORS });

        } catch (err) {
            console.error("[DRIVE-WEBHOOK] Upload error:", err);
            return new Response(JSON.stringify({ error: "Upload failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── BATCH UPLOAD ───────────────────────────────────────
    // POST /api/drive-webhook/batch-upload
    // Body: { files: [{ filename, fileSize, fileData?, caption? }], source?, creatorId? }
    if (path === "/batch-upload" && req.method === "POST") {
        const apiKey = req.headers.get("x-api-key");
        if (apiKey !== getPipelineApiKey()) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }

        try {
            const body = await req.json();
            const { files, source, creatorId } = body;

            if (!files || !Array.isArray(files) || files.length === 0) {
                return new Response(JSON.stringify({ error: "files array required" }), { status: 400, headers: CORS });
            }

            const results: Array<{ filename: string; pipelineId?: string; error?: string }> = [];

            for (const file of files) {
                try {
                    if (!isAllowedFile(file.filename)) {
                        results.push({ filename: file.filename, error: "File type not allowed" });
                        continue;
                    }

                    const result = await createPipelineItem({
                        filename: file.filename,
                        fileSize: file.fileSize || 0,
                        fileData: file.fileData,
                        source: source || "batch",
                        caption: file.caption,
                        creatorId
                    });

                    results.push({ filename: file.filename, pipelineId: result.pipelineId });
                } catch (err) {
                    results.push({ filename: file.filename, error: "Upload failed" });
                }
            }

            const succeeded = results.filter(r => r.pipelineId).length;
            return new Response(JSON.stringify({
                success: true,
                total: files.length,
                succeeded,
                failed: files.length - succeeded,
                results
            }), { headers: CORS });

        } catch (err) {
            return new Response(JSON.stringify({ error: "Batch upload failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── STATUS ─────────────────────────────────────────────
    // GET /api/drive-webhook/status
    if (path === "/status" && req.method === "GET") {
        return new Response(JSON.stringify({
            status: "active",
            endpoints: {
                google: "/api/drive-webhook/google",
                dropbox: "/api/drive-webhook/dropbox",
                upload: "/api/drive-webhook/upload",
                batchUpload: "/api/drive-webhook/batch-upload"
            },
            auth: "x-api-key header required for upload endpoints"
        }), { headers: CORS });
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
};

export const config = {
    path: ["/api/drive-webhook", "/api/drive-webhook/*"]
};
