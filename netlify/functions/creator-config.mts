import { getStore } from "@netlify/blobs";
import jwt from "jsonwebtoken";

// ═══════════════════════════════════════════════════════════════
// CREATOR CONFIG — Multi-creator configuration management
// ═══════════════════════════════════════════════════════════════
// Stores per-creator configs in Netlify Blobs
// Supports CRUD operations for onboarding new creators

const CORS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
};

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

// Default creator config template
function getDefaultConfig() {
    return {
        id: "",
        name: "",
        handle: "",
        domain: "",
        creatorTier: "A",
        brand: {
            colors: { primary: "#060606", accent: "#c22020", text: "#e8e4df", gold: "#c9a84c" },
            fonts: { display: "Bebas Neue", serif: "Cormorant Garamond", mono: "Space Mono" },
            ctaText: "Join Now",
            tagline: ""
        },
        features: {
            blog: false, membership: false, unlockPosts: false, contact: true,
            ageGate: false, faq: false, bookings: false, galleryFilters: true
        },
        membership: {
            tiers: {
                free: { name: "Free", price: 0, description: "Public gallery access" },
                vip: { name: "VIP", price: 9.99, description: "Exclusive content" },
                elite: { name: "Elite", price: 24.99, description: "Full access + perks" }
            }
        },
        socials: {},
        contentRules: {
            allowedFileTypes: ["jpg", "jpeg", "png", "webp", "mp4"],
            maxImageSizeMB: 25, maxVideoSizeMB: 500,
            autoWatermark: false, stripExif: true,
            compressImages: true, generateThumbnails: true,
            explicitAllowed: false,
            categories: ["photos", "selfies", "lifestyle"]
        },
        postingSchedule: { enabled: false, slots: [], autoFillSlots: false },
        telegram: {
            creatorBot: { enabled: false, token: "", chatId: "" },
            fanBot: { enabled: false, token: "", username: "" }
        },
        faq: {
            botTone: "professional",
            bannedPhrases: [],
            escalationKeywords: ["refund", "chargeback", "address", "meet", "minor"],
            templates: []
        },
        moderation: {
            level: "manual",
            autoApproveAfterChecks: false,
            notifyOnUpload: true,
            notifyOnPublish: true
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

export default async (req: Request, context: any) => {
    if (req.method === "OPTIONS") {
        return new Response("", { headers: CORS });
    }

    const url = new URL(req.url);
    const path = url.pathname.replace("/api/creator-config", "").replace(/\/$/, "") || "";
    const store = getStore("creator-configs");

    // ─── PUBLIC: Feature flags (no auth required) ─────────
    // GET /api/creator-config/features?id=inkedmayhem
    if (path === "/features" && req.method === "GET") {
        try {
            const id = url.searchParams.get("id") || "inkedmayhem";
            const config = await store.get(id, { type: "json" }) as any;
            if (!config) {
                return new Response(JSON.stringify({ success: true, features: {} }), { headers: CORS });
            }
            // Return only non-sensitive public info
            return new Response(JSON.stringify({
                success: true,
                features: config.features || {},
                brand: {
                    name: config.name || "",
                    tagline: config.brand?.tagline || "",
                    ctaText: config.brand?.ctaText || ""
                },
                membership: config.membership || {}
            }), { headers: CORS });
        } catch {
            return new Response(JSON.stringify({ success: true, features: {} }), { headers: CORS });
        }
    }

    // All routes below require admin auth
    if (!verifyAdmin(req)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
    }

    // ─── LIST ALL CREATORS ──────────────────────────────────
    // GET /api/creator-config/list
    if (path === "/list" && req.method === "GET") {
        try {
            const { blobs } = await store.list();
            const creators: any[] = [];
            for (const blob of blobs) {
                try {
                    const config = await store.get(blob.key, { type: "json" }) as any;
                    if (config) {
                        creators.push({
                            id: config.id,
                            name: config.name,
                            handle: config.handle,
                            domain: config.domain,
                            creatorTier: config.creatorTier,
                            features: config.features,
                            moderation: config.moderation,
                            createdAt: config.createdAt
                        });
                    }
                } catch {}
            }
            return new Response(JSON.stringify({ success: true, creators }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "List failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── GET CREATOR CONFIG ─────────────────────────────────
    // GET /api/creator-config/get?id=inkedmayhem
    if (path === "/get" && req.method === "GET") {
        try {
            const id = url.searchParams.get("id");
            if (!id) return new Response(JSON.stringify({ error: "id required" }), { status: 400, headers: CORS });

            const config = await store.get(id, { type: "json" });
            if (!config) return new Response(JSON.stringify({ error: "Creator not found" }), { status: 404, headers: CORS });

            return new Response(JSON.stringify({ success: true, config }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Get failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── CREATE/UPDATE CREATOR CONFIG ───────────────────────
    // POST /api/creator-config/save
    // Body: { config: { id, name, ... } }
    if (path === "/save" && req.method === "POST") {
        try {
            const { config: inputConfig } = await req.json();
            if (!inputConfig?.id) {
                return new Response(JSON.stringify({ error: "config.id required" }), { status: 400, headers: CORS });
            }

            // Merge with defaults
            let existing = null;
            try { existing = await store.get(inputConfig.id, { type: "json" }) as any; } catch {}

            const base = existing || getDefaultConfig();
            const merged = deepMerge(base, inputConfig);
            merged.updatedAt = new Date().toISOString();
            if (!existing) merged.createdAt = new Date().toISOString();

            await store.setJSON(inputConfig.id, merged);
            return new Response(JSON.stringify({ success: true, config: merged }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Save failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── DELETE CREATOR CONFIG ──────────────────────────────
    // POST /api/creator-config/delete
    // Body: { id }
    if (path === "/delete" && req.method === "POST") {
        try {
            const { id } = await req.json();
            if (!id) return new Response(JSON.stringify({ error: "id required" }), { status: 400, headers: CORS });
            await store.delete(id);
            return new Response(JSON.stringify({ success: true }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Delete failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── ONBOARD: Quick creator setup ───────────────────────
    // POST /api/creator-config/onboard
    // Body: { name, handle, domain?, photos?, about?, schedule?, membership? }
    if (path === "/onboard" && req.method === "POST") {
        try {
            const input = await req.json();
            if (!input.name) {
                return new Response(JSON.stringify({ error: "name required" }), { status: 400, headers: CORS });
            }

            const id = (input.handle || input.name).toLowerCase().replace(/[^a-z0-9]/g, "");
            const config = getDefaultConfig();

            config.id = id;
            config.name = input.name;
            config.handle = input.handle || `@${id}`;
            config.domain = input.domain || `${id}.netlify.app`;
            config.brand.tagline = input.tagline || "";

            if (input.membership) {
                config.features.membership = true;
                config.features.unlockPosts = true;
            }
            if (input.faq) config.features.faq = true;
            if (input.blog) config.features.blog = true;
            if (input.schedule) {
                config.postingSchedule.enabled = true;
                config.postingSchedule.slots = input.schedule.slots || [];
            }
            if (input.boundaries) {
                config.contentRules.explicitAllowed = input.boundaries.explicitAllowed || false;
            }

            await store.setJSON(id, config);

            return new Response(JSON.stringify({
                success: true,
                creatorId: id,
                config,
                nextSteps: [
                    "Upload logo and brand assets",
                    "Share the creator's Google Drive/Dropbox folder",
                    "Configure Telegram bots (optional)",
                    "Deploy the site",
                    "Run a test upload through the pipeline"
                ]
            }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Onboard failed" }), { status: 500, headers: CORS });
        }
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
};

// Deep merge utility
function deepMerge(target: any, source: any): any {
    const output = { ...target };
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
            output[key] = deepMerge(target[key] || {}, source[key]);
        } else {
            output[key] = source[key];
        }
    }
    return output;
}

export const config = {
    path: ["/api/creator-config", "/api/creator-config/*"]
};
