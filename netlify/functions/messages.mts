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

function verifyUser(req) {
    const auth = req.headers.get("authorization");
    if (!auth) return null;
    try {
        return jwt.verify(auth.replace("Bearer ", ""), getSecret());
    } catch { return null; }
}

export default async (req, context) => {
    if (req.method === "OPTIONS") return new Response("", { headers: CORS });

    const user = verifyUser(req);
    if (!user) return new Response(JSON.stringify({ error: "Sign in required" }), { status: 401, headers: CORS });

    const url = new URL(req.url);
    const action = url.pathname.replace("/api/messages", "").replace(/^\//, "");

    // ─── SEND MESSAGE ────────────────────────────
    if (req.method === "POST" && (action === "send" || action === "")) {
        try {
            const { text } = await req.json();
            if (!text || !text.trim()) return new Response(JSON.stringify({ error: "Message required" }), { status: 400, headers: CORS });

            // Save to conversations store
            const store = getStore("conversations");
            const convKey = `conv-${user.email.toLowerCase().replace(/[^a-z0-9@._-]/g, '')}`;
            let conv = null;
            try { conv = await store.get(convKey, { type: "json" }); } catch (err) { console.error("Conv lookup:", err); }
            if (!conv) conv = { email: user.email, messages: [] };

            conv.messages.push({
                from: "user",
                text: text.trim(),
                sentAt: new Date().toISOString()
            });
            await store.setJSON(convKey, conv);

            // Also save to contacts so it shows in admin inbox
            const contactStore = getStore("contacts");
            const msgKey = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
            await contactStore.setJSON(msgKey, {
                name: user.email,
                email: user.email,
                subject: "member-message",
                message: text.trim(),
                receivedAt: new Date().toISOString(),
                read: false,
                fromMember: true
            });

            return new Response(JSON.stringify({ success: true }), { headers: CORS });
        } catch (err) {
            console.error("Send error:", err);
            return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── GET MY MESSAGES ─────────────────────────
    if (req.method === "GET") {
        try {
            const store = getStore("conversations");
            const convKey = `conv-${user.email.toLowerCase().replace(/[^a-z0-9@._-]/g, '')}`;
            let conv = null;
            try { conv = await store.get(convKey, { type: "json" }); } catch (err) { console.error("Conv lookup:", err); }

            return new Response(JSON.stringify({
                success: true,
                messages: conv?.messages || [],
                hasThread: !!conv
            }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: CORS });
        }
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
};

export const config = {
    path: ["/api/messages", "/api/messages/*"]
};
