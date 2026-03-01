import { getStore } from "./lib/blobs.mjs";
import jwt from "jsonwebtoken";

const CORS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function getSecret() {
    return process.env.JWT_SECRET || "inkedmayhem-dev-secret-change-me";
}

async function sendTelegramNotification(text: string) {
    const botToken = process.env.TELEGRAM_CREATOR_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CREATOR_CHAT_ID;
    if (!botToken || !chatId) return;
    try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" })
        });
    } catch {}
}

export default async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("", { headers: CORS });
    }

    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
    }

    try {
        const authHeader = req.headers.get("authorization");
        if (!authHeader) {
            return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: CORS });
        }

        const token = authHeader.replace("Bearer ", "");
        let decoded: any;
        try {
            decoded = jwt.verify(token, getSecret());
        } catch {
            return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: CORS });
        }

        const { type, tier, postId, amount } = await req.json();
        const email = decoded.email;

        if (!email || !type) {
            return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: CORS });
        }

        const store = getStore("venmo-pending");
        const key = `venmo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const request: any = {
            email,
            type,
            amount: amount || 0,
            status: "pending",
            requestedAt: new Date().toISOString()
        };

        if (type === "subscription" && tier) {
            request.tier = tier;
        } else if (type === "single" && postId) {
            request.postId = postId;
        } else {
            return new Response(JSON.stringify({ error: "Invalid request type" }), { status: 400, headers: CORS });
        }

        await store.setJSON(key, request);

        // Notify admin via Telegram
        const label = type === "subscription"
            ? `${tier?.toUpperCase()} subscription ($${amount})`
            : `Post unlock: ${postId} ($${amount})`;
        await sendTelegramNotification(
            `💸 <b>Venmo Payment Pending</b>\n\n` +
            `<b>From:</b> ${email}\n` +
            `<b>For:</b> ${label}\n\n` +
            `Check your Venmo and approve in the admin dashboard.`
        );

        return new Response(JSON.stringify({ success: true }), { headers: CORS });
    } catch (err) {
        console.error("Venmo request error:", err);
        return new Response(JSON.stringify({ error: "Server error" }), { status: 500, headers: CORS });
    }
};

export const config = {
    path: "/api/venmo-request"
};
