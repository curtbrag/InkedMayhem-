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

        // Enforce canonical prices — reject requests with manipulated amounts.
        const TIER_PRICES: Record<string, number> = { vip: 9.99, elite: 24.99 };
        const SINGLE_PRICE = 4.99;
        let expectedAmount: number;
        if (type === "subscription") {
            if (!tier || !TIER_PRICES[tier]) {
                return new Response(JSON.stringify({ error: "Invalid tier" }), { status: 400, headers: CORS });
            }
            expectedAmount = TIER_PRICES[tier];
        } else if (type === "single") {
            if (!postId) {
                return new Response(JSON.stringify({ error: "Missing postId" }), { status: 400, headers: CORS });
            }
            expectedAmount = SINGLE_PRICE;
        } else {
            return new Response(JSON.stringify({ error: "Invalid request type" }), { status: 400, headers: CORS });
        }
        if (typeof amount !== "number" || Math.abs(amount - expectedAmount) > 0.01) {
            return new Response(JSON.stringify({ error: "Invalid amount" }), { status: 400, headers: CORS });
        }

        const store = getStore("venmo-pending");

        // Reject duplicate submissions from the same user within 60 seconds.
        const { blobs } = await store.list();
        const now = Date.now();
        for (const blob of blobs) {
            const r = await store.get(blob.key, { type: "json" }) as any;
            if (r && r.email === email && r.status === "pending") {
                const age = now - new Date(r.requestedAt).getTime();
                if (age < 60_000) {
                    return new Response(JSON.stringify({ error: "Duplicate request — please wait before retrying." }), { status: 429, headers: CORS });
                }
            }
        }

        const key = `venmo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const request: any = {
            email,
            type,
            amount: expectedAmount,
            status: "pending",
            requestedAt: new Date().toISOString()
        };

        if (type === "subscription") {
            request.tier = tier;
        } else {
            request.postId = postId;
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
