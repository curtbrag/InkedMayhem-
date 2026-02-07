import { getStore } from "@netlify/blobs";

export default async (req, context) => {
    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
    }

    try {
        const { name, email, subject, message } = await req.json();

        if (!name || !email || !message) {
            return new Response(JSON.stringify({ error: "Name, email, and message required" }), { status: 400 });
        }

        const store = getStore("contacts");
        const key = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

        await store.setJSON(key, {
            name,
            email,
            subject: subject || "other",
            message,
            receivedAt: new Date().toISOString(),
            read: false
        });

        return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (err) {
        console.error("Contact error:", err);
        return new Response(JSON.stringify({ error: "Server error" }), { status: 500 });
    }
};

export const config = {
    path: "/api/contact"
};
