import { getStore } from "@netlify/blobs";
import jwt from "jsonwebtoken";

const CORS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
};

function getSecret() {
    return Netlify.env.get("JWT_SECRET") || "inkedmayhem-dev-secret-change-me";
}

function getAdminPass() {
    return Netlify.env.get("ADMIN_PASSWORD") || "073588";
}

function verifyAdmin(req) {
    const auth = req.headers.get("authorization");
    if (!auth) return null;
    try {
        const token = auth.replace("Bearer ", "");
        const decoded = jwt.verify(token, getSecret());
        if (!decoded.isAdmin) return null;
        return decoded;
    } catch { return null; }
}

export default async (req, context) => {
    if (req.method === "OPTIONS") {
        return new Response("", { headers: CORS });
    }

    const url = new URL(req.url);
    const path = url.pathname.replace("/api/admin", "");

    // ─── ADMIN LOGIN ─────────────────────────────
    if (path === "/login" && req.method === "POST") {
        try {
            const { password } = await req.json();
            if (password !== getAdminPass()) {
                return new Response(JSON.stringify({ error: "Invalid password" }), { status: 401, headers: CORS });
            }
            const token = jwt.sign({ isAdmin: true, role: "admin" }, getSecret(), { expiresIn: "7d" });
            return new Response(JSON.stringify({ success: true, token }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Server error" }), { status: 500, headers: CORS });
        }
    }

    // All routes below require admin auth
    const admin = verifyAdmin(req);
    if (!admin) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
    }

    // ─── LIST USERS ──────────────────────────────
    if (path === "/users" && req.method === "GET") {
        try {
            const store = getStore("users");
            const { blobs } = await store.list();
            const users = [];
            for (const blob of blobs) {
                const user = await store.get(blob.key, { type: "json" });
                if (user) {
                    users.push({
                        key: blob.key,
                        email: user.email,
                        name: user.name || "—",
                        tier: user.tier || "free",
                        status: user.status || "active",
                        purchases: user.purchases || [],
                        createdAt: user.createdAt || "—",
                        lastLogin: user.lastLogin || null
                    });
                }
            }
            users.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

            // Pagination
            const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
            const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50")));
            const total = users.length;
            const paginated = users.slice((page - 1) * limit, page * limit);

            return new Response(JSON.stringify({ success: true, users: paginated, total, page, limit, pages: Math.ceil(total / limit) }), { headers: CORS });
        } catch (err) {
            console.error("List users error:", err);
            return new Response(JSON.stringify({ error: "Failed to list users" }), { status: 500, headers: CORS });
        }
    }

    // ─── UPDATE USER ─────────────────────────────
    if (path === "/users/update" && req.method === "POST") {
        try {
            const { userKey, tier, name, status } = await req.json();
            if (!userKey) return new Response(JSON.stringify({ error: "userKey required" }), { status: 400, headers: CORS });

            const store = getStore("users");
            const user = await store.get(userKey, { type: "json" });
            if (!user) return new Response(JSON.stringify({ error: "User not found" }), { status: 404, headers: CORS });

            if (tier) user.tier = tier;
            if (name) user.name = name;
            if (status !== undefined) user.status = status; // "active", "suspended", "banned"
            user.updatedAt = new Date().toISOString();

            await store.setJSON(userKey, user);
            return new Response(JSON.stringify({ success: true, user: { email: user.email, name: user.name, tier: user.tier, status: user.status } }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Update failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── BAN/SUSPEND USER ─────────────────────────
    if (path === "/users/ban" && req.method === "POST") {
        try {
            const { userKey, action, reason } = await req.json();
            if (!userKey || !action) return new Response(JSON.stringify({ error: "userKey and action required" }), { status: 400, headers: CORS });

            const store = getStore("users");
            const user = await store.get(userKey, { type: "json" });
            if (!user) return new Response(JSON.stringify({ error: "User not found" }), { status: 404, headers: CORS });

            if (action === "ban") {
                user.status = "banned";
                user.bannedAt = new Date().toISOString();
                user.banReason = reason || "Banned by admin";
            } else if (action === "suspend") {
                user.status = "suspended";
                user.suspendedAt = new Date().toISOString();
                user.suspendReason = reason || "Suspended by admin";
            } else if (action === "unban" || action === "unsuspend" || action === "activate") {
                user.status = "active";
                user.bannedAt = null;
                user.banReason = null;
                user.suspendedAt = null;
                user.suspendReason = null;
            } else {
                return new Response(JSON.stringify({ error: "Invalid action. Use: ban, suspend, activate" }), { status: 400, headers: CORS });
            }

            user.updatedAt = new Date().toISOString();
            await store.setJSON(userKey, user);

            return new Response(JSON.stringify({ success: true, status: user.status }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Action failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── DELETE USER ─────────────────────────────
    if (path === "/users/delete" && req.method === "POST") {
        try {
            const { userKey } = await req.json();
            if (!userKey) return new Response(JSON.stringify({ error: "userKey required" }), { status: 400, headers: CORS });

            const store = getStore("users");
            await store.delete(userKey);
            return new Response(JSON.stringify({ success: true }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Delete failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── LIST MESSAGES ───────────────────────────
    if (path === "/messages" && req.method === "GET") {
        try {
            const store = getStore("contacts");
            const { blobs } = await store.list();
            const messages = [];
            for (const blob of blobs) {
                const msg = await store.get(blob.key, { type: "json" });
                if (msg) {
                    messages.push({ key: blob.key, ...msg });
                }
            }
            messages.sort((a, b) => (b.receivedAt || "").localeCompare(a.receivedAt || ""));
            const unread = messages.filter(m => !m.read).length;

            // Pagination
            const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
            const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50")));
            const total = messages.length;
            const paginated = messages.slice((page - 1) * limit, page * limit);

            return new Response(JSON.stringify({ success: true, messages: paginated, total, unread, page, limit, pages: Math.ceil(total / limit) }), { headers: CORS });
        } catch (err) {
            console.error("List messages error:", err);
            return new Response(JSON.stringify({ error: "Failed to list messages" }), { status: 500, headers: CORS });
        }
    }

    // ─── MARK MESSAGE READ ───────────────────────
    if (path === "/messages/read" && req.method === "POST") {
        try {
            const { messageKey } = await req.json();
            const store = getStore("contacts");
            const msg = await store.get(messageKey, { type: "json" });
            if (!msg) return new Response(JSON.stringify({ error: "Message not found" }), { status: 404, headers: CORS });

            msg.read = true;
            msg.readAt = new Date().toISOString();
            await store.setJSON(messageKey, msg);
            return new Response(JSON.stringify({ success: true }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── DELETE MESSAGE ──────────────────────────
    if (path === "/messages/delete" && req.method === "POST") {
        try {
            const { messageKey } = await req.json();
            const store = getStore("contacts");
            await store.delete(messageKey);
            return new Response(JSON.stringify({ success: true }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── REPLY TO MESSAGE ────────────────────────
    if (path === "/messages/reply" && req.method === "POST") {
        try {
            const { messageKey, reply } = await req.json();
            const store = getStore("contacts");
            const msg = await store.get(messageKey, { type: "json" });
            if (!msg) return new Response(JSON.stringify({ error: "Message not found" }), { status: 404, headers: CORS });

            if (!msg.replies) msg.replies = [];
            msg.replies.push({
                text: reply,
                sentAt: new Date().toISOString(),
                from: "admin"
            });
            msg.read = true;
            msg.readAt = msg.readAt || new Date().toISOString();
            msg.replied = true;

            await store.setJSON(messageKey, msg);

            // Also store in user's conversation thread if they have an account
            const userStore = getStore("conversations");
            const convKey = `conv-${msg.email.toLowerCase().replace(/[^a-z0-9@._-]/g, '')}`;
            let conv = null;
            try { conv = await userStore.get(convKey, { type: "json" }); } catch (err) { console.error("Conv lookup:", err); }
            if (!conv) conv = { email: msg.email, messages: [] };
            conv.messages.push({
                from: "admin",
                text: reply,
                sentAt: new Date().toISOString()
            });
            await userStore.setJSON(convKey, conv);

            return new Response(JSON.stringify({ success: true }), { headers: CORS });
        } catch (err) {
            console.error("Reply error:", err);
            return new Response(JSON.stringify({ error: "Reply failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── DELETE CONVERSATION ─────────────────────
    if (path === "/conversations/delete" && req.method === "POST") {
        try {
            const { convKey } = await req.json();
            const store = getStore("conversations");
            await store.delete(convKey);
            return new Response(JSON.stringify({ success: true }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── LIST CONVERSATIONS ──────────────────────
    if (path === "/conversations" && req.method === "GET") {
        try {
            const store = getStore("conversations");
            const { blobs } = await store.list();
            const convos = [];
            for (const blob of blobs) {
                const conv = await store.get(blob.key, { type: "json" });
                if (conv) {
                    const lastMsg = conv.messages?.[conv.messages.length - 1];
                    convos.push({
                        key: blob.key,
                        email: conv.email,
                        messageCount: conv.messages?.length || 0,
                        lastMessage: lastMsg?.text?.substring(0, 80) || "",
                        lastAt: lastMsg?.sentAt || "",
                        lastFrom: lastMsg?.from || ""
                    });
                }
            }
            convos.sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));
            return new Response(JSON.stringify({ success: true, conversations: convos }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── GET CONVERSATION ────────────────────────
    if (path === "/conversations/thread" && req.method === "POST") {
        try {
            const { convKey } = await req.json();
            const store = getStore("conversations");
            const conv = await store.get(convKey, { type: "json" });
            if (!conv) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
            return new Response(JSON.stringify({ success: true, conversation: conv }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── SEND MESSAGE TO USER ────────────────────
    if (path === "/conversations/send" && req.method === "POST") {
        try {
            const { email, text } = await req.json();
            if (!email || !text) return new Response(JSON.stringify({ error: "email and text required" }), { status: 400, headers: CORS });

            const store = getStore("conversations");
            const convKey = `conv-${email.toLowerCase().replace(/[^a-z0-9@._-]/g, '')}`;
            let conv = null;
            try { conv = await store.get(convKey, { type: "json" }); } catch (err) { console.error("Conv lookup:", err); }
            if (!conv) conv = { email: email.toLowerCase(), messages: [] };

            conv.messages.push({
                from: "admin",
                text,
                sentAt: new Date().toISOString()
            });
            await store.setJSON(convKey, conv);
            return new Response(JSON.stringify({ success: true }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Send failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── STATS ───────────────────────────────────
    if (path === "/stats" && req.method === "GET") {
        try {
            const userStore = getStore("users");
            const msgStore = getStore("contacts");
            const convStore = getStore("conversations");
            const contentStore = getStore("content");

            const [userBlobs, msgBlobs, convBlobs, contentBlobs] = await Promise.all([
                userStore.list(), msgStore.list(), convStore.list(), contentStore.list()
            ]);

            const tiers = { free: 0, vip: 0, elite: 0 };
            const signupDates = [];
            const loginDates = [];
            for (const blob of userBlobs.blobs) {
                const u = await userStore.get(blob.key, { type: "json" });
                if (u?.tier) tiers[u.tier] = (tiers[u.tier] || 0) + 1;
                if (u?.createdAt) signupDates.push(u.createdAt);
                if (u?.lastLogin) loginDates.push(u.lastLogin);
            }

            let unread = 0;
            for (const blob of msgBlobs.blobs) {
                const m = await msgStore.get(blob.key, { type: "json" });
                if (m && !m.read) unread++;
            }

            // Recent activity (last 7 days)
            const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            const recentSignups = signupDates.filter(d => d > weekAgo).length;
            const recentLogins = loginDates.filter(d => d > weekAgo).length;

            return new Response(JSON.stringify({
                success: true,
                stats: {
                    totalUsers: userBlobs.blobs.length,
                    tiers,
                    totalMessages: msgBlobs.blobs.length,
                    unreadMessages: unread,
                    totalConversations: convBlobs.blobs.length,
                    totalContent: contentBlobs.blobs.length,
                    recentSignups,
                    recentLogins,
                    signupDates: signupDates.sort(),
                    loginDates: loginDates.sort()
                }
            }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Stats failed" }), { status: 500, headers: CORS });
        }
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
};

export const config = {
    path: ["/api/admin", "/api/admin/*"]
};
