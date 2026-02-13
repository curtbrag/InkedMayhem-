import { getStore } from "@netlify/blobs";
import bcrypt from "bcryptjs";
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
    const path = url.pathname.replace("/api/me", "").replace(/\/$/, "") || "";
    const store = getStore("users");

    // ─── GET PROFILE ─────────────────────────────
    if (path === "" && req.method === "GET") {
        const user_jwt = verifyUser(req);
        if (!user_jwt) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: CORS });

        const userKey = user_jwt.email.toLowerCase().replace(/[^a-z0-9@._-]/g, '');
        const user = await store.get(userKey, { type: "json" });
        if (!user) return new Response(JSON.stringify({ error: "User not found" }), { status: 404, headers: CORS });

        return new Response(JSON.stringify({
            success: true,
            user: {
                email: user.email,
                name: user.name,
                tier: user.tier || "free",
                purchases: user.purchases || [],
                createdAt: user.createdAt,
                lastLogin: user.lastLogin,
                subscribedAt: user.subscribedAt || null,
                cancelPending: user.cancelPending || false,
                cancelAt: user.cancelAt || null
            }
        }), { headers: CORS });
    }

    // ─── UPDATE PROFILE (name) ───────────────────
    if (path === "/update" && req.method === "POST") {
        const user_jwt = verifyUser(req);
        if (!user_jwt) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: CORS });

        try {
            const { name } = await req.json();
            if (!name || !name.trim()) return new Response(JSON.stringify({ error: "Name required" }), { status: 400, headers: CORS });

            const userKey = user_jwt.email.toLowerCase().replace(/[^a-z0-9@._-]/g, '');
            const user = await store.get(userKey, { type: "json" });
            if (!user) return new Response(JSON.stringify({ error: "User not found" }), { status: 404, headers: CORS });

            user.name = name.trim();
            await store.setJSON(userKey, user);

            return new Response(JSON.stringify({ success: true, user: { email: user.email, name: user.name, tier: user.tier } }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Update failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── CHANGE PASSWORD ─────────────────────────
    if (path === "/password" && req.method === "POST") {
        const user_jwt = verifyUser(req);
        if (!user_jwt) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: CORS });

        try {
            const { currentPassword, newPassword } = await req.json();
            if (!currentPassword || !newPassword) return new Response(JSON.stringify({ error: "Both passwords required" }), { status: 400, headers: CORS });
            if (newPassword.length < 6) return new Response(JSON.stringify({ error: "Password must be at least 6 characters" }), { status: 400, headers: CORS });

            const userKey = user_jwt.email.toLowerCase().replace(/[^a-z0-9@._-]/g, '');
            const user = await store.get(userKey, { type: "json" });
            if (!user) return new Response(JSON.stringify({ error: "User not found" }), { status: 404, headers: CORS });

            const valid = await bcrypt.compare(currentPassword, user.hash);
            if (!valid) return new Response(JSON.stringify({ error: "Current password is wrong" }), { status: 401, headers: CORS });

            user.hash = await bcrypt.hash(newPassword, 10);
            await store.setJSON(userKey, user);

            return new Response(JSON.stringify({ success: true }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── ADMIN: RESET USER PASSWORD ──────────────
    if (path === "/admin-reset" && req.method === "POST") {
        const auth = req.headers.get("authorization");
        if (!auth) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        try {
            const d = jwt.verify(auth.replace("Bearer ", ""), getSecret());
            if (!d.isAdmin && !d.admin) throw new Error();
        } catch {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }

        try {
            const { email, newPassword } = await req.json();
            if (!email || !newPassword) return new Response(JSON.stringify({ error: "Email and password required" }), { status: 400, headers: CORS });

            const userKey = email.toLowerCase().replace(/[^a-z0-9@._-]/g, '');
            const user = await store.get(userKey, { type: "json" });
            if (!user) return new Response(JSON.stringify({ error: "User not found" }), { status: 404, headers: CORS });

            user.hash = await bcrypt.hash(newPassword, 10);
            await store.setJSON(userKey, user);

            return new Response(JSON.stringify({ success: true }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Reset failed" }), { status: 500, headers: CORS });
        }
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
};

export const config = {
    path: ["/api/me", "/api/me/*"]
};
