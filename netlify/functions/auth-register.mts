import { getStore } from "@netlify/blobs";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

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
    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
    }

    try {
        const { email, password, name } = await req.json();

        if (!email || !password) {
            return new Response(JSON.stringify({ error: "Email and password required" }), { status: 400 });
        }

        if (password.length < 6) {
            return new Response(JSON.stringify({ error: "Password must be at least 6 characters" }), { status: 400 });
        }

        const store = getStore("users");
        const userKey = email.toLowerCase().replace(/[^a-z0-9@._-]/g, '');

        const existing = await store.get(userKey, { type: "json" });
        if (existing) {
            return new Response(JSON.stringify({ error: "Account already exists" }), { status: 409 });
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
        }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (err) {
        console.error("Register error:", err);
        return new Response(JSON.stringify({ error: "Server error" }), { status: 500 });
    }
};

export const config = {
    path: "/api/auth-register"
};
