import { getStore } from "@netlify/blobs";

const CORS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
};

async function notifyAdmin(type, data) {
    const secret = Netlify.env.get("JWT_SECRET") || "inkedmayhem-dev-secret-change-me";
    const siteUrl = Netlify.env.get("URL") || "https://inkedmayhem.netlify.app";
    try {
        await fetch(`${siteUrl}/api/notify`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-internal-key": secret },
            body: JSON.stringify({ type, data })
        });
    } catch (err) { console.error("Notify error:", err); }
}

export default async (req, context) => {
    if (req.method === "OPTIONS") return new Response("", { headers: CORS });
    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
    }

    try {
        const { name, email, subject, message } = await req.json();

        if (!name || !email || !message) {
            return new Response(JSON.stringify({ error: "Name, email, and message required" }), { status: 400, headers: CORS });
        }

        const store = getStore("contacts");
        const key = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

        await store.setJSON(key, {
            name,
            email,
            subject: subject || "General",
            message,
            receivedAt: new Date().toISOString(),
            read: false
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
