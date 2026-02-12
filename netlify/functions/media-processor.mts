import sharp from "sharp";
import { getStore } from "@netlify/blobs";

// ═══════════════════════════════════════════════════════════════
// MEDIA PROCESSOR — EXIF strip, compress, thumbnail, watermark
// ═══════════════════════════════════════════════════════════════
// Called internally by the pipeline during the "process" step.
// Also exposed as an API for direct processing requests.

const CORS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"];
const THUMBNAIL_WIDTH = 400;
const THUMBNAIL_HEIGHT = 500;
const WEB_MAX_WIDTH = 1920;
const WEB_MAX_HEIGHT = 1920;
const WEB_QUALITY = 82;
const THUMBNAIL_QUALITY = 70;

interface ProcessingResult {
    exifStripped: boolean;
    compressed: boolean;
    thumbnailGenerated: boolean;
    watermarked: boolean;
    originalSizeBytes: number;
    processedSizeBytes: number;
    thumbnailSizeBytes: number;
    format: string;
    width: number;
    height: number;
    errors: string[];
}

/**
 * Process a single image from pipeline-assets store:
 * 1. Read the raw asset
 * 2. Strip EXIF/metadata
 * 3. Resize to web-friendly dimensions
 * 4. Compress (output as webp or original format)
 * 5. Generate thumbnail
 * 6. Optionally apply watermark
 * 7. Write processed + thumbnail back to store
 */
export async function processImage(
    assetKey: string,
    options: {
        stripExif?: boolean;
        compress?: boolean;
        generateThumbnail?: boolean;
        watermark?: boolean;
        watermarkText?: string;
        outputFormat?: "webp" | "jpeg" | "png" | "original";
    } = {}
): Promise<ProcessingResult> {
    const {
        stripExif = true,
        compress = true,
        generateThumbnail = true,
        watermark = false,
        watermarkText = "",
        outputFormat = "original"
    } = options;

    const result: ProcessingResult = {
        exifStripped: false,
        compressed: false,
        thumbnailGenerated: false,
        watermarked: false,
        originalSizeBytes: 0,
        processedSizeBytes: 0,
        thumbnailSizeBytes: 0,
        format: "",
        width: 0,
        height: 0,
        errors: []
    };

    const assetStore = getStore("pipeline-assets");

    try {
        // 1. Read raw asset
        const rawData = await assetStore.get(assetKey, { type: "arrayBuffer" });
        if (!rawData) {
            result.errors.push("Asset not found in store");
            return result;
        }

        const inputBuffer = Buffer.from(rawData);
        result.originalSizeBytes = inputBuffer.length;

        // Detect format
        const ext = (assetKey.split(".").pop() || "").toLowerCase();
        if (!IMAGE_EXTENSIONS.includes(ext)) {
            result.errors.push(`Not an image format: ${ext}`);
            return result;
        }

        // 2. Build the sharp pipeline
        let pipeline = sharp(inputBuffer);

        // Get original metadata before stripping
        const metadata = await pipeline.metadata();
        result.format = metadata.format || ext;
        result.width = metadata.width || 0;
        result.height = metadata.height || 0;

        // 3. Strip EXIF/metadata (always rotate first to honor EXIF orientation)
        if (stripExif) {
            pipeline = pipeline.rotate(); // auto-rotate based on EXIF before stripping
            result.exifStripped = true;
        }

        // 4. Resize to web-friendly max dimensions (don't upscale)
        if (compress && (result.width > WEB_MAX_WIDTH || result.height > WEB_MAX_HEIGHT)) {
            pipeline = pipeline.resize(WEB_MAX_WIDTH, WEB_MAX_HEIGHT, {
                fit: "inside",
                withoutEnlargement: true
            });
        }

        // 5. Watermark (text overlay)
        if (watermark && watermarkText) {
            const wWidth = Math.max(result.width, 800);
            const fontSize = Math.round(wWidth * 0.03);
            const svgOverlay = Buffer.from(`
                <svg width="${result.width}" height="${result.height}">
                    <style>
                        .watermark {
                            fill: rgba(255,255,255,0.25);
                            font-family: sans-serif;
                            font-size: ${fontSize}px;
                            font-weight: bold;
                            letter-spacing: 4px;
                        }
                    </style>
                    <text x="50%" y="95%" text-anchor="middle" class="watermark">${escapeXml(watermarkText)}</text>
                </svg>
            `);
            pipeline = pipeline.composite([{ input: svgOverlay, top: 0, left: 0 }]);
            result.watermarked = true;
        }

        // 6. Output format + compression
        let outputExt = ext;
        if (compress) {
            if (outputFormat === "webp" || (outputFormat === "original" && ext !== "png" && ext !== "gif")) {
                // Convert to webp for best compression (except PNG transparency and GIF)
                if (ext === "png" || ext === "gif") {
                    pipeline = pipeline.png({ quality: WEB_QUALITY, effort: 4 });
                    outputExt = ext;
                } else {
                    pipeline = pipeline.webp({ quality: WEB_QUALITY, effort: 4 });
                    outputExt = "webp";
                }
            } else if (outputFormat === "jpeg" || ext === "jpg" || ext === "jpeg") {
                pipeline = pipeline.jpeg({ quality: WEB_QUALITY, mozjpeg: true });
                outputExt = "jpg";
            } else if (outputFormat === "png" || ext === "png") {
                pipeline = pipeline.png({ quality: WEB_QUALITY, effort: 4 });
                outputExt = "png";
            }
            result.compressed = true;
        }

        // Remove all metadata (EXIF, IPTC, XMP, ICC profile for non-PNG)
        pipeline = pipeline.withMetadata(stripExif ? {} : undefined as any);

        const processedBuffer = await pipeline.toBuffer();
        result.processedSizeBytes = processedBuffer.length;

        // Get final dimensions
        const processedMeta = await sharp(processedBuffer).metadata();
        result.width = processedMeta.width || result.width;
        result.height = processedMeta.height || result.height;

        // Write processed image back (overwrite original key or new key)
        const processedKey = assetKey.replace(/\.[^.]+$/, `-processed.${outputExt}`);
        await assetStore.set(processedKey, processedBuffer);

        // Also overwrite the original key with the processed version
        // so the asset URL stays the same
        await assetStore.set(assetKey, processedBuffer);

        // 7. Generate thumbnail
        if (generateThumbnail) {
            const thumbBuffer = await sharp(processedBuffer)
                .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, {
                    fit: "cover",
                    position: "centre"
                })
                .webp({ quality: THUMBNAIL_QUALITY })
                .toBuffer();

            const thumbKey = assetKey.replace(/\.[^.]+$/, "-thumb.webp");
            await assetStore.set(thumbKey, thumbBuffer);
            result.thumbnailSizeBytes = thumbBuffer.length;
            result.thumbnailGenerated = true;
        }

    } catch (err: any) {
        result.errors.push(`Processing error: ${err.message || err}`);
    }

    return result;
}

function escapeXml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

// ═══════════════════════════════════════════════════════════════
// HTTP HANDLER — Direct API access for processing
// ═══════════════════════════════════════════════════════════════
// POST /api/media-processor
// Body: { assetKey, stripExif?, compress?, generateThumbnail?, watermark?, watermarkText? }

export default async (req: Request, context: any) => {
    if (req.method === "OPTIONS") {
        return new Response("", { headers: CORS });
    }

    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
    }

    // Auth check — internal API key or admin JWT
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = Netlify.env.get("PIPELINE_API_KEY") ||
        Netlify.env.get("JWT_SECRET") ||
        "inkedmayhem-dev-secret-change-me";

    if (apiKey !== expectedKey) {
        // Try JWT admin check
        const auth = req.headers.get("authorization");
        if (!auth) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }
        try {
            const jwt = await import("jsonwebtoken");
            const decoded = jwt.default.verify(auth.replace("Bearer ", ""), expectedKey) as any;
            if (!decoded.isAdmin) {
                return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
            }
        } catch {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }
    }

    try {
        const body = await req.json();
        const { assetKey, stripExif, compress, generateThumbnail, watermark, watermarkText } = body;

        if (!assetKey) {
            return new Response(JSON.stringify({ error: "assetKey required" }), { status: 400, headers: CORS });
        }

        const result = await processImage(assetKey, {
            stripExif: stripExif !== false,
            compress: compress !== false,
            generateThumbnail: generateThumbnail !== false,
            watermark: watermark || false,
            watermarkText: watermarkText || ""
        });

        const savings = result.originalSizeBytes > 0
            ? Math.round((1 - result.processedSizeBytes / result.originalSizeBytes) * 100)
            : 0;

        return new Response(JSON.stringify({
            success: result.errors.length === 0,
            result,
            savings: `${savings}% smaller`,
            errors: result.errors
        }), { headers: CORS });

    } catch (err: any) {
        console.error("[MEDIA-PROCESSOR] Error:", err);
        return new Response(JSON.stringify({ error: "Processing failed", details: err.message }), {
            status: 500,
            headers: CORS
        });
    }
};

export const config = {
    path: "/api/media-processor"
};
