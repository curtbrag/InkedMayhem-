import { getStore } from "@netlify/blobs";
import jwt from "jsonwebtoken";

const CORS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function getSecret() {
    return Netlify.env.get("JWT_SECRET") || "inkedmayhem-dev-secret-change-me";
}

function verifyAdmin(req) {
    const auth = req.headers.get("authorization");
    if (!auth) return false;
    try {
        const d = jwt.verify(auth.replace("Bearer ", ""), getSecret());
        return d.isAdmin === true;
    } catch { return false; }
}

function verifyUser(req) {
    const auth = req.headers.get("authorization");
    if (!auth) return null;
    try {
        return jwt.verify(auth.replace("Bearer ", ""), getSecret());
    } catch { return null; }
}

export default async (req, context) => {
    if (req.method === "OPTIONS") return new Response("", { headers: CORS });

    const url = new URL(req.url);
    const path = url.pathname.replace("/api/content", "").replace(/\/$/, "") || "";
    const store = getStore("content");

    // ─── PUBLIC: GET CONTENT LIST ─────────────────
    if (path === "" && req.method === "GET") {
        const tier = url.searchParams.get("tier") || "all";
        const search = (url.searchParams.get("search") || "").toLowerCase().trim();
        const category = (url.searchParams.get("category") || "").toLowerCase().trim();
        const sort = url.searchParams.get("sort") || "newest"; // newest, oldest, title
        try {
            const { blobs } = await store.list();
            const items = [];
            for (const blob of blobs) {
                try {
                    const item = await store.get(blob.key, { type: "json" });
                    if (item && !item.draft) items.push({ ...item, key: blob.key });
                } catch (err) { console.error("Content item read error:", err); }
            }

            // Filter by tier access
            let filtered = tier === "all" ? items : items.filter(i => {
                if (i.tier === "free") return true;
                if (tier === "elite") return true;
                if (tier === "vip" && i.tier !== "elite") return true;
                return false;
            });

            // Server-side search
            if (search) {
                filtered = filtered.filter(i =>
                    (i.title || "").toLowerCase().includes(search) ||
                    (i.body || "").toLowerCase().includes(search) ||
                    (i.category || "").toLowerCase().includes(search)
                );
            }

            // Category filter
            if (category) {
                filtered = filtered.filter(i => (i.category || "").toLowerCase() === category);
            }

            // Sort
            if (sort === "oldest") {
                filtered.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            } else if (sort === "title") {
                filtered.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
            } else {
                filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            }

            // Pagination
            const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
            const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50")));
            const total = filtered.length;
            const paginated = filtered.slice((page - 1) * limit, page * limit);

            return new Response(JSON.stringify({
                success: true,
                content: paginated,
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Failed to load content" }), { status: 500, headers: CORS });
        }
    }

    // ─── PUBLIC: GET SINGLE CONTENT ───────────────
    if (path.startsWith("/view/") && req.method === "GET") {
        const key = path.replace("/view/", "");
        try {
            const item = await store.get(key, { type: "json" });
            if (!item) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });

            // Check tier access using fresh user data
            const jwtUser = verifyUser(req);
            let userTier = "free";
            let purchased = false;
            if (jwtUser?.email) {
                try {
                    const userStore = getStore("users");
                    const userKey = jwtUser.email.toLowerCase().replace(/[^a-z0-9@._-]/g, '');
                    const freshUser = await userStore.get(userKey, { type: "json" });
                    if (freshUser) {
                        userTier = freshUser.tier || "free";
                        purchased = (freshUser.purchases || []).some(p => p.postId === key);
                    }
                } catch (err) { console.error("User lookup for view access:", err); }
            }

            // Allow access if purchased via PPV
            if (!purchased) {
                if (item.tier === "vip" && userTier === "free") {
                    return new Response(JSON.stringify({ error: "VIP content", locked: true, tier: "vip" }), { status: 403, headers: CORS });
                }
                if (item.tier === "elite" && userTier !== "elite") {
                    return new Response(JSON.stringify({ error: "Elite content", locked: true, tier: "elite" }), { status: 403, headers: CORS });
                }
            }

            return new Response(JSON.stringify({ success: true, content: item }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── ADMIN: CREATE/UPDATE CONTENT ─────────────
    if (path === "/save" && req.method === "POST") {
        if (!verifyAdmin(req)) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        try {
            const { key, title, body, tier, type, imageUrl, draft, price } = await req.json();
            if (!title || !body) return new Response(JSON.stringify({ error: "Title and body required" }), { status: 400, headers: CORS });

            const contentKey = key || `content-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
            
            let existing = null;
            try { existing = await store.get(contentKey, { type: "json" }); } catch (err) { console.error("Content lookup:", err); }

            const item = {
                title,
                body,
                tier: tier || "free",
                type: type || "post", // post, gallery, announcement
                imageUrl: imageUrl || "",
                price: price ? parseFloat(price) : null,
                draft: draft || false,
                createdAt: existing?.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            await store.setJSON(contentKey, item);
            return new Response(JSON.stringify({ success: true, key: contentKey }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Save failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── ADMIN: DELETE CONTENT ────────────────────
    if (path === "/delete" && req.method === "POST") {
        if (!verifyAdmin(req)) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        try {
            const { key } = await req.json();
            await store.delete(key);
            return new Response(JSON.stringify({ success: true }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Delete failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── ADMIN: LIST ALL (including drafts) ──────
    if (path === "/admin-list" && req.method === "GET") {
        if (!verifyAdmin(req)) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        try {
            const { blobs } = await store.list();
            const items = [];
            for (const blob of blobs) {
                try {
                    const item = await store.get(blob.key, { type: "json" });
                    if (item) items.push({ ...item, key: blob.key });
                } catch (err) { console.error("Admin content read error:", err); }
            }
            items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            return new Response(JSON.stringify({ success: true, content: items }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: CORS });
        }
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
};

export const config = {
    path: ["/api/content", "/api/content/*"]
};
