import { getStore } from "@netlify/blobs";
import jwt from "jsonwebtoken";

// ═══════════════════════════════════════════════════════════════
// DMCA TAKEDOWN — Accept, track, and process DMCA requests
// ═══════════════════════════════════════════════════════════════

const CORS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function getSecret() {
    return Netlify.env.get("JWT_SECRET") || "inkedmayhem-dev-secret-change-me";
}

function verifyAdmin(req: Request) {
    const auth = req.headers.get("authorization");
    if (!auth) return false;
    try {
        const d = jwt.verify(auth.replace("Bearer ", ""), getSecret()) as any;
        return d.admin === true || d.isAdmin === true;
    } catch { return false; }
}

// Rate limit: max 5 DMCA requests per IP per day
async function checkRateLimit(ip: string): Promise<boolean> {
    const store = getStore("dmca-ratelimits");
    const key = `dmca-${ip.replace(/[^a-z0-9.:]/gi, "")}`;
    try {
        const record = await store.get(key, { type: "json" }) as any;
        if (record) {
            const dayMs = 24 * 60 * 60 * 1000;
            if (Date.now() - new Date(record.windowStart).getTime() < dayMs) {
                if (record.count >= 5) return false;
                record.count++;
                await store.setJSON(key, record);
                return true;
            }
        }
        await store.setJSON(key, { count: 1, windowStart: new Date().toISOString() });
        return true;
    } catch { return true; }
}

async function notifyAdminDmca(request: any) {
    const botToken = Netlify.env.get("TELEGRAM_CREATOR_BOT_TOKEN");
    const chatId = Netlify.env.get("TELEGRAM_ADMIN_CHAT_ID") || Netlify.env.get("TELEGRAM_CREATOR_CHAT_ID");
    if (!botToken || !chatId) return;
    try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text: `⚠️ <b>DMCA Takedown Request</b>\n\n` +
                    `<b>From:</b> ${request.fullName}\n` +
                    `<b>Email:</b> ${request.email}\n` +
                    `<b>Content URL:</b> ${request.contentUrl}\n` +
                    `<b>Description:</b> ${request.description}\n` +
                    `<b>ID:</b> <code>${request.id}</code>\n\n` +
                    `⏳ Respond within 24-48 hours`,
                parse_mode: "HTML"
            })
        });
    } catch {}
}

export default async (req: Request, context: any) => {
    if (req.method === "OPTIONS") {
        return new Response("", { headers: CORS });
    }

    const url = new URL(req.url);
    const path = url.pathname.replace("/api/dmca", "").replace(/\/$/, "") || "";

    // ─── SUBMIT DMCA REQUEST (public) ────────────────────────
    // POST /api/dmca/submit
    if (path === "/submit" && req.method === "POST") {
        const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            || req.headers.get("x-nf-client-connection-ip")
            || "unknown";

        const allowed = await checkRateLimit(clientIp);
        if (!allowed) {
            return new Response(JSON.stringify({ error: "Too many requests. Try again later." }), {
                status: 429, headers: CORS
            });
        }

        try {
            const body = await req.json();
            const { fullName, email, contentUrl, description, originalWorkUrl, sworn } = body;

            // Validate required fields
            if (!fullName || !email || !contentUrl || !description) {
                return new Response(JSON.stringify({
                    error: "Required: fullName, email, contentUrl, description"
                }), { status: 400, headers: CORS });
            }

            if (!sworn) {
                return new Response(JSON.stringify({
                    error: "You must affirm the sworn statement (sworn: true)"
                }), { status: 400, headers: CORS });
            }

            const store = getStore("dmca-requests");
            const requestId = `dmca-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;

            const dmcaRequest = {
                id: requestId,
                status: "pending", // pending → acknowledged → actioned → resolved | rejected
                fullName,
                email: email.toLowerCase(),
                contentUrl,
                description,
                originalWorkUrl: originalWorkUrl || "",
                sworn: true,
                submittedAt: new Date().toISOString(),
                acknowledgedAt: null,
                resolvedAt: null,
                adminNotes: "",
                actionTaken: "",
                submitterIp: clientIp
            };

            await store.setJSON(requestId, dmcaRequest);

            // Notify admin immediately
            await notifyAdminDmca(dmcaRequest);

            return new Response(JSON.stringify({
                success: true,
                requestId,
                message: "DMCA takedown request received. We will review and respond within 24-48 hours.",
                contact: "If urgent, contact us via the site contact form."
            }), { headers: CORS });

        } catch (err) {
            return new Response(JSON.stringify({ error: "Submission failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── LIST DMCA REQUESTS (admin) ──────────────────────────
    // GET /api/dmca/list?status=pending|acknowledged|actioned|resolved|rejected|all
    if (path === "/list" && req.method === "GET") {
        if (!verifyAdmin(req)) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }

        try {
            const statusFilter = url.searchParams.get("status") || "all";
            const store = getStore("dmca-requests");
            const { blobs } = await store.list();
            const requests: any[] = [];

            for (const blob of blobs) {
                try {
                    const item = await store.get(blob.key, { type: "json" }) as any;
                    if (item && (statusFilter === "all" || item.status === statusFilter)) {
                        requests.push(item);
                    }
                } catch {}
            }

            requests.sort((a, b) => (b.submittedAt || "").localeCompare(a.submittedAt || ""));

            return new Response(JSON.stringify({ success: true, requests, total: requests.length }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "List failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── ACKNOWLEDGE DMCA REQUEST (admin) ────────────────────
    // POST /api/dmca/acknowledge
    // Body: { requestId }
    if (path === "/acknowledge" && req.method === "POST") {
        if (!verifyAdmin(req)) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }

        try {
            const { requestId } = await req.json();
            const store = getStore("dmca-requests");
            const item = await store.get(requestId, { type: "json" }) as any;
            if (!item) {
                return new Response(JSON.stringify({ error: "Request not found" }), { status: 404, headers: CORS });
            }

            item.status = "acknowledged";
            item.acknowledgedAt = new Date().toISOString();
            await store.setJSON(requestId, item);

            return new Response(JSON.stringify({ success: true, status: "acknowledged" }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── RESOLVE DMCA REQUEST (admin) ────────────────────────
    // POST /api/dmca/resolve
    // Body: { requestId, actionTaken, adminNotes?, removeContent? (bool), contentKey? }
    if (path === "/resolve" && req.method === "POST") {
        if (!verifyAdmin(req)) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }

        try {
            const { requestId, actionTaken, adminNotes, removeContent, contentKey } = await req.json();
            const store = getStore("dmca-requests");
            const item = await store.get(requestId, { type: "json" }) as any;
            if (!item) {
                return new Response(JSON.stringify({ error: "Request not found" }), { status: 404, headers: CORS });
            }

            item.status = "resolved";
            item.resolvedAt = new Date().toISOString();
            item.actionTaken = actionTaken || "Content removed";
            item.adminNotes = adminNotes || "";

            // Actually remove the content if requested
            let contentRemoved = false;
            if (removeContent && contentKey) {
                try {
                    const contentStore = getStore("content");
                    await contentStore.delete(contentKey);
                    contentRemoved = true;
                } catch {}
            }

            await store.setJSON(requestId, item);

            return new Response(JSON.stringify({
                success: true,
                status: "resolved",
                contentRemoved
            }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── REJECT DMCA REQUEST (admin) ─────────────────────────
    // POST /api/dmca/reject
    // Body: { requestId, reason }
    if (path === "/reject" && req.method === "POST") {
        if (!verifyAdmin(req)) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }

        try {
            const { requestId, reason } = await req.json();
            const store = getStore("dmca-requests");
            const item = await store.get(requestId, { type: "json" }) as any;
            if (!item) {
                return new Response(JSON.stringify({ error: "Request not found" }), { status: 404, headers: CORS });
            }

            item.status = "rejected";
            item.resolvedAt = new Date().toISOString();
            item.adminNotes = reason || "Request rejected — does not meet DMCA requirements";
            await store.setJSON(requestId, item);

            return new Response(JSON.stringify({ success: true, status: "rejected" }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── CHECK STATUS (public — by request ID) ──────────────
    // GET /api/dmca/status?id=dmca-xxx
    if (path === "/status" && req.method === "GET") {
        try {
            const requestId = url.searchParams.get("id");
            if (!requestId) {
                return new Response(JSON.stringify({ error: "id required" }), { status: 400, headers: CORS });
            }

            const store = getStore("dmca-requests");
            const item = await store.get(requestId, { type: "json" }) as any;
            if (!item) {
                return new Response(JSON.stringify({ error: "Request not found" }), { status: 404, headers: CORS });
            }

            // Only return safe public fields
            return new Response(JSON.stringify({
                success: true,
                requestId: item.id,
                status: item.status,
                submittedAt: item.submittedAt,
                acknowledgedAt: item.acknowledgedAt,
                resolvedAt: item.resolvedAt
            }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: CORS });
        }
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
};

export const config = {
    path: ["/api/dmca", "/api/dmca/*"]
};
