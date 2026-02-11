import { getStore } from "@netlify/blobs";

const CORS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
};

// Rate limiting: max 5 contact submissions per IP per hour
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

async function checkRateLimit(ip) {
    const store = getStore("auth-ratelimits");
    const key = `contact-${ip.replace(/[^a-z0-9.:]/gi, "")}`;
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

// Basic email format check
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Simple spam detection
function isSpammy(text) {
    const spamPatterns = [
        /\b(viagra|cialis|casino|lottery|winner|congratulations.*won)\b/i,
        /(http[s]?:\/\/[^\s]+){3,}/i, // 3+ URLs
        /(.)\1{10,}/  // 10+ repeated chars
    ];
    return spamPatterns.some(p => p.test(text));
}

async function notifyAdmin(type, data) {
    const secret = Netlify.env.get("JWT_SECRET") || "inkedmayhem-dev-secret-change-me";
    const siteUrl = Netlify.env.get("URL") || "https://inkedmayhem.netlify.app";
    try {
        await fetch(`${siteUrl}/api/notify`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-internal-key": secret },
            body: JSON.stringify({ type, data })
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
        // Rate limit
        const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            || req.headers.get("x-nf-client-connection-ip")
            || "unknown";
        const allowed = await checkRateLimit(clientIp);
        if (!allowed) {
            return new Response(JSON.stringify({ error: "Too many submissions. Try again later." }), {
                status: 429,
                headers: { ...CORS, "Retry-After": "3600" }
            });
        }

        const { name, email, subject, message, _hp } = await req.json();

        // Honeypot field — if filled, it's a bot
        if (_hp) {
            return new Response(JSON.stringify({ success: true }), { headers: CORS });
        }

        if (!name || !email || !message) {
            return new Response(JSON.stringify({ error: "Name, email, and message required" }), { status: 400, headers: CORS });
        }

        if (!isValidEmail(email)) {
            return new Response(JSON.stringify({ error: "Invalid email address" }), { status: 400, headers: CORS });
        }

        if (name.length > 100 || email.length > 200 || message.length > 5000) {
            return new Response(JSON.stringify({ error: "Input too long" }), { status: 400, headers: CORS });
        }

        if (isSpammy(message) || isSpammy(name)) {
            return new Response(JSON.stringify({ success: true }), { headers: CORS });
        }

        const store = getStore("contacts");
        const key = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

        await store.setJSON(key, {
            name,
            email,
            subject: subject || "General",
            message,
            receivedAt: new Date().toISOString(),
            read: false,
            ip: clientIp
        });

        // Fire notification
        notifyAdmin("contact_form", { name, email, subject, message });

        return new Response(JSON.stringify({ success: true }), { headers: CORS });

    } catch (err) {
        console.error("Contact error:", err);
        return new Response(JSON.stringify({ error: "Server error" }), { status: 500, headers: CORS });
    }
};

export const config = {
    path: "/api/contact"
};
