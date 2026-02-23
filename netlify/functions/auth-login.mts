import { getStore } from "@netlify/blobs";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const CORS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
};

// Rate limiting: max 10 login attempts per IP per 15 minutes
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

async function checkRateLimit(ip) {
    const store = getStore("auth-ratelimits");
    const key = `login-${ip.replace(/[^a-z0-9.:]/gi, "")}`;
    try {
        const record = await store.get(key, { type: "json" });
        if (record) {
            const windowStart = new Date(record.windowStart).getTime();
            if (Date.now() - windowStart < RATE_LIMIT_WINDOW_MS) {
                if (record.count >= RATE_LIMIT_MAX) return false;
                record.count++;
                await store.setJSON(key, record);
                return true;
            }
        }
        await store.setJSON(key, { count: 1, windowStart: new Date().toISOString() });
        return true;
    } catch {
        return true; // Allow on error
    }
}

export default async (req, context) => {
    if (req.method === "OPTIONS") {
        return new Response("", { headers: CORS });
    }

    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
    }

    try {
        // Rate limit check
        const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            || req.headers.get("x-nf-client-connection-ip")
            || "unknown";
        const allowed = await checkRateLimit(clientIp);
        if (!allowed) {
            return new Response(JSON.stringify({ error: "Too many login attempts. Try again in 15 minutes." }), {
                status: 429,
                headers: { ...CORS, "Retry-After": "900" }
            });
        }

        const { email, password } = await req.json();

        if (!email || !password) {
            return new Response(JSON.stringify({ error: "Email and password required" }), { status: 400, headers: CORS });
        }

        const store = getStore("users");
        const userKey = email.toLowerCase().replace(/[^a-z0-9@._-]/g, '');

        const user = await store.get(userKey, { type: "json" });
        if (!user) {
            return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401, headers: CORS });
        }

        const valid = await bcrypt.compare(password, user.hash);
        if (!valid) {
            return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401, headers: CORS });
        }

        // Check ban/suspend status
        if (user.status === "banned") {
            return new Response(JSON.stringify({ error: "Account has been banned" }), { status: 403, headers: CORS });
        }
        if (user.status === "suspended") {
            return new Response(JSON.stringify({ error: "Account is suspended. Contact support." }), { status: 403, headers: CORS });
        }

        // Track last login
        user.lastLogin = new Date().toISOString();
        await store.setJSON(userKey, user);

        const secret = process.env.JWT_SECRET || "inkedmayhem-dev-secret-change-me";
        const token = jwt.sign({ email: user.email, tier: user.tier }, secret, { expiresIn: "30d" });

        return new Response(JSON.stringify({
            success: true,
            token,
            user: { email: user.email, name: user.name, tier: user.tier }
        }), { headers: CORS });

    } catch (err) {
        console.error("Login error:", err);
        return new Response(JSON.stringify({ error: "Server error" }), { status: 500, headers: CORS });
    }
};

export const config = {
    path: "/api/auth-login"
};
