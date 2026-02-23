import { getStore } from "@netlify/blobs";
import jwt from "jsonwebtoken";

// ═══════════════════════════════════════════════════════════════
// ADMIN EXPORT — Data export & backup for admin
// ═══════════════════════════════════════════════════════════════
// Exports all data from blob stores as JSON for backup/migration.
// Supports full export or per-store export.

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
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

async function exportStore(storeName: string) {
    const store = getStore(storeName);
    const { blobs } = await store.list();
    const data: Record<string, any> = {};

    for (const blob of blobs) {
        try {
            const item = await store.get(blob.key, { type: "json" });
            if (item) data[blob.key] = item;
        } catch {
            // Some items may be binary (pipeline-assets), skip those
            data[blob.key] = { _binary: true, _key: blob.key };
        }
    }

    return { store: storeName, count: Object.keys(data).length, data };
}

export default async (req: Request, context: any) => {
    if (req.method === "OPTIONS") {
        return new Response("", { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    if (!verifyAdmin(req)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...CORS, "Content-Type": "application/json" }
        });
    }

    const url = new URL(req.url);
    const path = url.pathname.replace("/api/admin-export", "").replace(/\/$/, "") || "";

    // ─── FULL EXPORT ─────────────────────────────────────────
    // GET /api/admin-export
    // Returns all data stores as a single JSON backup
    if (path === "" && req.method === "GET") {
        try {
            const storeNames = [
                "users", "content", "pipeline", "pipeline-logs",
                "conversations", "creator-configs",
                "telegram-logs", "telegram-escalations", "telegram-faq-stats"
            ];

            const exports: Record<string, any> = {};
            const summary: Record<string, number> = {};

            for (const name of storeNames) {
                try {
                    const result = await exportStore(name);
                    exports[name] = result.data;
                    summary[name] = result.count;
                } catch (err) {
                    exports[name] = { _error: String(err) };
                    summary[name] = 0;
                }
            }

            const backup = {
                version: "1.0",
                exportedAt: new Date().toISOString(),
                platform: "InkedMayhem Creator Platform",
                summary,
                stores: exports
            };

            return new Response(JSON.stringify(backup, null, 2), {
                headers: {
                    ...CORS,
                    "Content-Type": "application/json",
                    "Content-Disposition": `attachment; filename="inkedmayhem-backup-${new Date().toISOString().split("T")[0]}.json"`
                }
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Export failed" }), {
                status: 500,
                headers: { ...CORS, "Content-Type": "application/json" }
            });
        }
    }

    // ─── SINGLE STORE EXPORT ─────────────────────────────────
    // GET /api/admin-export/store?name=users
    if (path === "/store" && req.method === "GET") {
        try {
            const storeName = url.searchParams.get("name");
            if (!storeName) {
                return new Response(JSON.stringify({ error: "name parameter required" }), {
                    status: 400,
                    headers: { ...CORS, "Content-Type": "application/json" }
                });
            }

            const result = await exportStore(storeName);
            return new Response(JSON.stringify({
                version: "1.0",
                exportedAt: new Date().toISOString(),
                ...result
            }, null, 2), {
                headers: {
                    ...CORS,
                    "Content-Type": "application/json",
                    "Content-Disposition": `attachment; filename="${storeName}-export-${new Date().toISOString().split("T")[0]}.json"`
                }
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Store export failed" }), {
                status: 500,
                headers: { ...CORS, "Content-Type": "application/json" }
            });
        }
    }

    // ─── IMPORT/RESTORE ──────────────────────────────────────
    // POST /api/admin-export/import
    // Body: { store: "users", data: { key1: {...}, key2: {...} } }
    if (path === "/import" && req.method === "POST") {
        try {
            const { store: storeName, data } = await req.json();
            if (!storeName || !data || typeof data !== "object") {
                return new Response(JSON.stringify({ error: "store and data required" }), {
                    status: 400,
                    headers: { ...CORS, "Content-Type": "application/json" }
                });
            }

            const store = getStore(storeName);
            let imported = 0;
            let errors = 0;

            for (const [key, value] of Object.entries(data)) {
                try {
                    if (value && typeof value === "object" && !(value as any)._binary) {
                        await store.setJSON(key, value);
                        imported++;
                    }
                } catch {
                    errors++;
                }
            }

            return new Response(JSON.stringify({
                success: true,
                store: storeName,
                imported,
                errors,
                total: Object.keys(data).length
            }), {
                headers: { ...CORS, "Content-Type": "application/json" }
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Import failed" }), {
                status: 500,
                headers: { ...CORS, "Content-Type": "application/json" }
            });
        }
    }

    // ─── STATS SUMMARY ───────────────────────────────────────
    // GET /api/admin-export/stats
    // Quick summary of all store sizes without downloading data
    if (path === "/stats" && req.method === "GET") {
        try {
            const storeNames = [
                "users", "content", "pipeline", "pipeline-logs", "pipeline-assets",
                "conversations", "creator-configs",
                "telegram-logs", "telegram-escalations", "telegram-faq-stats",
                "telegram-ratelimits"
            ];

            const stats: Record<string, number> = {};
            let totalItems = 0;

            for (const name of storeNames) {
                try {
                    const store = getStore(name);
                    const { blobs } = await store.list();
                    stats[name] = blobs.length;
                    totalItems += blobs.length;
                } catch {
                    stats[name] = -1; // Error
                }
            }

            return new Response(JSON.stringify({
                success: true,
                timestamp: new Date().toISOString(),
                totalItems,
                stores: stats
            }), {
                headers: { ...CORS, "Content-Type": "application/json" }
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Stats failed" }), {
                status: 500,
                headers: { ...CORS, "Content-Type": "application/json" }
            });
        }
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...CORS, "Content-Type": "application/json" }
    });
};

export const config = {
    path: ["/api/admin-export", "/api/admin-export/*"]
};
