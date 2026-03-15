import { getStore } from "./lib/blobs.mjs";
import jwt from "jsonwebtoken";

// ═══════════════════════════════════════════════════════════════
// PROMO CODES — Discount code management with Stripe coupon support
// ═══════════════════════════════════════════════════════════════

const CORS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function getSecret() {
    return process.env.JWT_SECRET || "inkedmayhem-dev-secret-change-me";
}

// Rate limiting for public validate endpoint: 20 attempts per IP per 15 min
async function checkValidateRateLimit(ip: string): Promise<boolean> {
    const rlStore = getStore("auth-ratelimits");
    const key = `promo-${ip.replace(/[^a-z0-9.:]/gi, "")}`;
    try {
        const record = await rlStore.get(key, { type: "json" }) as any;
        if (record) {
            const windowStart = new Date(record.windowStart).getTime();
            if (Date.now() - windowStart < 15 * 60 * 1000) {
                if (record.count >= 20) return false;
                record.count++;
                await rlStore.setJSON(key, record);
                return true;
            }
        }
        await rlStore.setJSON(key, { count: 1, windowStart: new Date().toISOString() });
        return true;
    } catch { return true; }
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

export default async (req: Request, context: any) => {
    if (req.method === "OPTIONS") {
        return new Response("", { headers: CORS });
    }

    const url = new URL(req.url);
    const path = url.pathname.replace("/api/promo-codes", "").replace(/\/$/, "") || "";
    const store = getStore("promo-codes");

    // ─── PUBLIC: VALIDATE PROMO CODE ─────────────────────────
    // POST /api/promo-codes/validate
    // Body: { code }
    if (path === "/validate" && req.method === "POST") {
        // Rate limit to prevent brute-force code enumeration
        const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            || req.headers.get("x-nf-client-connection-ip") || "unknown";
        const allowed = await checkValidateRateLimit(clientIp);
        if (!allowed) {
            return new Response(JSON.stringify({ valid: false, error: "Too many attempts. Try again later." }), {
                status: 429, headers: { ...CORS, "Retry-After": "900" }
            });
        }

        try {
            const { code } = await req.json();
            if (!code) {
                return new Response(JSON.stringify({ valid: false, error: "Code required" }), { headers: CORS });
            }

            const promo = await store.get(code.toUpperCase(), { type: "json" }) as any;
            if (!promo || !promo.active) {
                return new Response(JSON.stringify({ valid: false, error: "Invalid code" }), { headers: CORS });
            }

            if (promo.expiresAt && promo.expiresAt < new Date().toISOString()) {
                return new Response(JSON.stringify({ valid: false, error: "Code expired" }), { headers: CORS });
            }

            if (promo.maxUses && promo.usedCount >= promo.maxUses) {
                return new Response(JSON.stringify({ valid: false, error: "Code fully redeemed" }), { headers: CORS });
            }

            return new Response(JSON.stringify({
                valid: true,
                code: promo.code,
                description: promo.description || "",
                discountType: promo.discountType,
                discountValue: promo.discountValue,
                applicableTiers: promo.applicableTiers || ["vip", "elite"]
            }), { headers: CORS });
        } catch {
            return new Response(JSON.stringify({ valid: false, error: "Validation failed" }), { headers: CORS });
        }
    }

    // All routes below require admin auth
    if (!verifyAdmin(req)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
    }

    // ─── LIST ALL PROMO CODES ────────────────────────────────
    // GET /api/promo-codes
    if (path === "" && req.method === "GET") {
        try {
            const { blobs } = await store.list();
            const codes: any[] = [];
            for (const blob of blobs) {
                try {
                    const promo = await store.get(blob.key, { type: "json" });
                    if (promo) codes.push(promo);
                } catch {}
            }
            codes.sort((a: any, b: any) => (b.createdAt || "").localeCompare(a.createdAt || ""));
            return new Response(JSON.stringify({ success: true, codes, total: codes.length }), { headers: CORS });
        } catch {
            return new Response(JSON.stringify({ error: "List failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── CREATE PROMO CODE ───────────────────────────────────
    // POST /api/promo-codes/create
    // Body: { code, description, discountType, discountValue, maxUses?, expiresAt?, applicableTiers?, stripeCouponId? }
    if (path === "/create" && req.method === "POST") {
        try {
            const input = await req.json();
            if (!input.code || !input.discountType || !input.discountValue) {
                return new Response(JSON.stringify({ error: "code, discountType, and discountValue required" }), { status: 400, headers: CORS });
            }

            const code = input.code.toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (code.length < 3 || code.length > 20) {
                return new Response(JSON.stringify({ error: "Code must be 3-20 alphanumeric characters" }), { status: 400, headers: CORS });
            }

            // Check for duplicate
            const existing = await store.get(code, { type: "json" });
            if (existing) {
                return new Response(JSON.stringify({ error: "Code already exists" }), { status: 409, headers: CORS });
            }

            const promo = {
                code,
                description: input.description || "",
                discountType: input.discountType, // "percent" or "fixed"
                discountValue: Number(input.discountValue), // percent (e.g. 20) or cents (e.g. 500 = $5)
                maxUses: input.maxUses ? Number(input.maxUses) : null,
                usedCount: 0,
                usedBy: [],
                applicableTiers: input.applicableTiers || ["vip", "elite"],
                stripeCouponId: input.stripeCouponId || null,
                active: true,
                expiresAt: input.expiresAt || null,
                createdAt: new Date().toISOString()
            };

            await store.setJSON(code, promo);
            return new Response(JSON.stringify({ success: true, promo }), { headers: CORS });
        } catch {
            return new Response(JSON.stringify({ error: "Create failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── TOGGLE PROMO CODE ───────────────────────────────────
    // POST /api/promo-codes/toggle
    // Body: { code }
    if (path === "/toggle" && req.method === "POST") {
        try {
            const { code } = await req.json();
            if (!code) return new Response(JSON.stringify({ error: "Code required" }), { status: 400, headers: CORS });

            const promo = await store.get(code.toUpperCase(), { type: "json" }) as any;
            if (!promo) return new Response(JSON.stringify({ error: "Code not found" }), { status: 404, headers: CORS });

            promo.active = !promo.active;
            await store.setJSON(code.toUpperCase(), promo);
            return new Response(JSON.stringify({ success: true, active: promo.active }), { headers: CORS });
        } catch {
            return new Response(JSON.stringify({ error: "Toggle failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── DELETE PROMO CODE ───────────────────────────────────
    // POST /api/promo-codes/delete
    // Body: { code }
    if (path === "/delete" && req.method === "POST") {
        try {
            const { code } = await req.json();
            if (!code) return new Response(JSON.stringify({ error: "Code required" }), { status: 400, headers: CORS });
            await store.delete(code.toUpperCase());
            return new Response(JSON.stringify({ success: true }), { headers: CORS });
        } catch {
            return new Response(JSON.stringify({ error: "Delete failed" }), { status: 500, headers: CORS });
        }
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
};

export const config = {
    path: ["/api/promo-codes", "/api/promo-codes/*"]
};
