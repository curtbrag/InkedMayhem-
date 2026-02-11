import { getStore } from "@netlify/blobs";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const CORS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
};

// Rate limiting: max 5 registrations per IP per hour
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

async function checkRateLimit(ip) {
    const store = getStore("auth-ratelimits");
    const key = `register-${ip.replace(/[^a-z0-9.:]/gi, "")}`;
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
        return true;
    }
}

async function notifyAdmin(type, data, secret) {
    const siteUrl = Netlify.env.get("URL") || "https://inkedmayhem.netlify.app";
    try {
        await fetch(`${siteUrl}/api/notify`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-internal-key": secret },
            body: JSON.stringify({ type, data })
        });
    } catch {}
}

async function sendTelegramSignup(name, email) {
    const botToken = Netlify.env.get("TELEGRAM_CREATOR_BOT_TOKEN");
    const chatId = Netlify.env.get("TELEGRAM_ADMIN_CHAT_ID") || Netlify.env.get("TELEGRAM_CREATOR_CHAT_ID");
    if (!botToken || !chatId) return;
    try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text: `👤 <b>New Member!</b>\n\n<b>${name || "Unknown"}</b> just signed up.\nEmail: ${email}`,
                parse_mode: "HTML"
            })
        });
    } catch {}
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
            return new Response(JSON.stringify({ error: "Too many registration attempts. Try again later." }), {
                status: 429,
                headers: { ...CORS, "Retry-After": "3600" }
            });
        }

        const { email, password, name } = await req.json();

        if (!email || !password) {
            return new Response(JSON.stringify({ error: "Email and password required" }), { status: 400, headers: CORS });
        }

        if (password.length < 6) {
            return new Response(JSON.stringify({ error: "Password must be at least 6 characters" }), { status: 400, headers: CORS });
        }

        const store = getStore("users");
        const userKey = email.toLowerCase().replace(/[^a-z0-9@._-]/g, '');

        const existing = await store.get(userKey, { type: "json" });
        if (existing) {
            return new Response(JSON.stringify({ error: "Account already exists" }), { status: 409, headers: CORS });
        }

        const hash = await bcrypt.hash(password, 10);
        const user = {
            email: email.toLowerCase(),
            name: name || "Member",
            hash,
            tier: "free",
            purchases: [],
            createdAt: new Date().toISOString()
        };

        await store.setJSON(userKey, user);

        const secret = Netlify.env.get("JWT_SECRET") || "inkedmayhem-dev-secret-change-me";
        const token = jwt.sign({ email: user.email, tier: user.tier }, secret, { expiresIn: "30d" });

        // Fire notifications (non-blocking)
        notifyAdmin("new_signup", { email: user.email, name: user.name }, secret);
        sendTelegramSignup(user.name, user.email);

        return new Response(JSON.stringify({
            success: true,
            token,
            user: { email: user.email, name: user.name, tier: user.tier }
        }), { headers: CORS });

    } catch (err) {
        console.error("Register error:", err);
        return new Response(JSON.stringify({ error: "Server error" }), { status: 500, headers: CORS });
    }
};

export const config = {
    path: "/api/auth-register"
};
