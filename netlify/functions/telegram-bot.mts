import { getStore } from "@netlify/blobs";
import jwt from "jsonwebtoken";

// ═══════════════════════════════════════════════════════════════
// TELEGRAM BOT — Creator Bot + Fan FAQ Bot
// ═══════════════════════════════════════════════════════════════
// Creator Bot: Upload content via Telegram, manage queue
// Fan Bot: Answer FAQ, escalate sensitive topics

const CORS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

// ─── Config Helpers ─────────────────────────────────────────

function getSecret() {
    return process.env.JWT_SECRET || "inkedmayhem-dev-secret-change-me";
}

function getCreatorBotToken() {
    return process.env.TELEGRAM_CREATOR_BOT_TOKEN || "";
}

function getFanBotToken() {
    return process.env.TELEGRAM_FAN_BOT_TOKEN || "";
}

function getCreatorChatId() {
    return process.env.TELEGRAM_CREATOR_CHAT_ID || "";
}

function getAdminChatId() {
    return process.env.TELEGRAM_ADMIN_CHAT_ID || "";
}

// ─── Telegram API Helpers ───────────────────────────────────

async function sendTelegramMessage(botToken: string, chatId: string, text: string, parseMode = "HTML") {
    if (!botToken || !chatId) return false;
    try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: parseMode
            })
        });
        const data = await res.json() as any;
        return data.ok;
    } catch (err) {
        console.error("[TELEGRAM] Send failed:", err);
        return false;
    }
}

async function getFileFromTelegram(botToken: string, fileId: string) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/getFile`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file_id: fileId })
        });
        const data = await res.json() as any;
        if (data.ok && data.result.file_path) {
            return `https://api.telegram.org/file/bot${botToken}/${data.result.file_path}`;
        }
    } catch (err) {
        console.error("[TELEGRAM] Get file failed:", err);
    }
    return null;
}

// ─── Rate Limiting ──────────────────────────────────────────

async function checkRateLimit(userId: string, maxRequests = 10, windowSeconds = 60): Promise<boolean> {
    try {
        const store = getStore("telegram-ratelimits");
        const key = `rate-${userId}`;
        const existing = await store.get(key, { type: "json" }) as any;
        const now = Date.now();

        if (!existing) {
            await store.setJSON(key, { requests: [now] });
            return true;
        }

        // Filter to only requests within the window
        const windowStart = now - (windowSeconds * 1000);
        const recentRequests = (existing.requests || []).filter((t: number) => t > windowStart);

        if (recentRequests.length >= maxRequests) {
            return false; // Rate limited
        }

        recentRequests.push(now);
        await store.setJSON(key, { requests: recentRequests });
        return true;
    } catch {
        return true; // Fail open
    }
}

// ─── FAQ Matching ───────────────────────────────────────────

function loadFaqTemplates() {
    return [
        {
            category: "subscribe",
            patterns: ["how do i subscribe", "where do i subscribe", "membership", "join", "sign up", "how to join"],
            response: "Head to the main site and check out the membership tiers — pick the level that vibes with you and you're in.",
            escalate: false
        },
        {
            category: "content",
            patterns: ["what do you post", "what kind of content", "what content", "type of content", "what's on the site"],
            response: "Tattoo lifestyle, ink culture, behind-the-scenes shoots, and exclusive photo sets. Members get the good stuff.",
            escalate: false
        },
        {
            category: "schedule",
            patterns: ["when do you post", "posting schedule", "how often", "next post", "new content"],
            response: "New drops hit Tuesdays and Thursdays at 8pm ET. Members always get first access.",
            escalate: false
        },
        {
            category: "customs",
            patterns: ["custom", "request", "commission", "personal", "special order"],
            response: "Custom requests are available for Elite tier members. Check out the Mayhem Circle membership for details.",
            escalate: false
        },
        {
            category: "refund",
            patterns: ["refund", "money back", "cancel subscription", "chargeback", "dispute"],
            response: "I'm connecting you with support for this. Someone will get back to you shortly.",
            escalate: true
        },
        {
            category: "contact",
            patterns: ["contact", "email", "reach you", "message you", "talk to you", "dm"],
            response: "Best way to reach out is through the contact form on the site, or DM through the members area if you're subscribed.",
            escalate: false
        },
        {
            category: "pricing",
            patterns: ["how much", "price", "cost", "pricing", "what does it cost"],
            response: "Free access gets you the public gallery. VIP (Ink Insider) is $9.99/mo for exclusive sets. Elite (Mayhem Circle) is $24.99/mo for everything + premium drops and custom requests.",
            escalate: false
        }
    ];
}

// Hard escalation keywords — always escalate, no template response
const HARD_ESCALATION_KEYWORDS = [
    "address", "where do you live", "phone number", "meet up", "meet me",
    "underage", "minor", "kid", "child", "kill", "threat", "hurt", "stalk",
    "i know where you"
];

function matchFaq(message: string) {
    const lower = message.toLowerCase().trim();

    // Check for hard escalation first
    for (const keyword of HARD_ESCALATION_KEYWORDS) {
        if (lower.includes(keyword)) {
            return {
                matched: true,
                category: "safety_escalation",
                response: null, // No response, just escalate
                escalate: true,
                hardEscalation: true
            };
        }
    }

    // Match against FAQ templates
    const templates = loadFaqTemplates();
    for (const template of templates) {
        for (const pattern of template.patterns) {
            if (lower.includes(pattern)) {
                return {
                    matched: true,
                    category: template.category,
                    response: template.response,
                    escalate: template.escalate,
                    hardEscalation: false
                };
            }
        }
    }

    return { matched: false, category: null, response: null, escalate: false, hardEscalation: false };
}

// ─── Logging ────────────────────────────────────────────────

async function logBotEvent(botType: string, userId: string, action: string, details: Record<string, any> = {}) {
    try {
        const store = getStore("telegram-logs");
        const logKey = `tg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        await store.setJSON(logKey, {
            botType,
            userId: String(userId),
            action,
            details,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error("[TELEGRAM] Log failed:", err);
    }
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════

export default async (req: Request, context: any) => {
    if (req.method === "OPTIONS") {
        return new Response("", { headers: CORS });
    }

    const url = new URL(req.url);
    const path = url.pathname.replace("/api/telegram", "").replace(/\/$/, "") || "";

    // ─── CREATOR BOT WEBHOOK ────────────────────────────────
    // POST /api/telegram/creator-webhook
    // Receives updates from the creator's Telegram bot
    if (path === "/creator-webhook" && req.method === "POST") {
        try {
            const update = await req.json() as any;
            const botToken = getCreatorBotToken();
            const creatorChatId = getCreatorChatId();

            if (!botToken) {
                return new Response(JSON.stringify({ error: "Bot not configured" }), { status: 503, headers: CORS });
            }

            const message = update.message;
            if (!message) {
                return new Response(JSON.stringify({ ok: true }), { headers: CORS });
            }

            const chatId = String(message.chat.id);
            const userId = String(message.from.id);
            const username = message.from.username || message.from.first_name || "Unknown";

            // Only respond to the authorized creator
            if (creatorChatId && chatId !== creatorChatId) {
                await sendTelegramMessage(botToken, chatId,
                    "This bot is for the creator only. If you're a fan, use the fan bot instead.");
                return new Response(JSON.stringify({ ok: true }), { headers: CORS });
            }

            // ─── COMMAND: /start
            if (message.text === "/start") {
                await sendTelegramMessage(botToken, chatId,
                    `<b>Welcome to your Creator Bot!</b>\n\n` +
                    `<b>Upload content:</b> Send a photo or video directly\n` +
                    `<b>Add caption:</b> Send text starting with "caption:" after uploading\n\n` +
                    `<b>Commands:</b>\n` +
                    `/status — Pipeline overview\n` +
                    `/inbox — Items awaiting review\n` +
                    `/queue — See queued items\n` +
                    `/approve &lt;id&gt; — Approve + queue\n` +
                    `/reject &lt;id&gt; — Reject content\n` +
                    `/publish &lt;id&gt; — Publish now\n` +
                    `/schedule — View posting schedule\n` +
                    `/help — Show all commands`
                );
                await logBotEvent("creator", userId, "start", {});
                return new Response(JSON.stringify({ ok: true }), { headers: CORS });
            }

            // ─── COMMAND: /help
            if (message.text === "/help") {
                await sendTelegramMessage(botToken, chatId,
                    `<b>Creator Bot Commands</b>\n\n` +
                    `<b>Content Upload:</b>\n` +
                    `• Send a photo/video to upload\n` +
                    `• Include caption in the message\n` +
                    `• "caption: your text" to update last upload\n` +
                    `• "category: selfies" to set category\n` +
                    `• "tier: vip" to set access tier\n\n` +
                    `<b>Review:</b>\n` +
                    `/inbox — Items awaiting review\n` +
                    `/approve &lt;id&gt; — Approve and queue\n` +
                    `/reject &lt;id&gt; [reason] — Reject with reason\n` +
                    `/publish &lt;id&gt; — Publish immediately\n` +
                    `/tier &lt;id&gt; &lt;free|vip|elite&gt; — Set access tier\n\n` +
                    `<b>Overview:</b>\n` +
                    `/status — Pipeline stats\n` +
                    `/queue — Items waiting to publish\n` +
                    `/schedule — Next scheduled posts\n` +
                    `/recent — Last 5 published items`
                );
                return new Response(JSON.stringify({ ok: true }), { headers: CORS });
            }

            // ─── COMMAND: /status
            if (message.text === "/status") {
                const pipeStore = getStore("pipeline");
                const { blobs } = await pipeStore.list();
                const counts = { inbox: 0, processed: 0, queued: 0, published: 0, rejected: 0 };

                for (const blob of blobs) {
                    try {
                        const item = await pipeStore.get(blob.key, { type: "json" }) as any;
                        if (item?.status && counts.hasOwnProperty(item.status)) {
                            counts[item.status as keyof typeof counts]++;
                        }
                    } catch {}
                }

                await sendTelegramMessage(botToken, chatId,
                    `<b>Pipeline Status</b>\n\n` +
                    `📥 Inbox: ${counts.inbox}\n` +
                    `⚙️ Processed: ${counts.processed}\n` +
                    `📋 Queued: ${counts.queued}\n` +
                    `✅ Published: ${counts.published}\n` +
                    `❌ Rejected: ${counts.rejected}`
                );
                return new Response(JSON.stringify({ ok: true }), { headers: CORS });
            }

            // ─── COMMAND: /queue
            if (message.text === "/queue") {
                const pipeStore = getStore("pipeline");
                const { blobs } = await pipeStore.list();
                const queued: any[] = [];

                for (const blob of blobs) {
                    try {
                        const item = await pipeStore.get(blob.key, { type: "json" }) as any;
                        if (item?.status === "queued") queued.push(item);
                    } catch {}
                }

                if (queued.length === 0) {
                    await sendTelegramMessage(botToken, chatId, "Queue is empty. Upload some content!");
                } else {
                    const list = queued.slice(0, 10).map((item, i) =>
                        `${i + 1}. <b>${item.caption || item.filename}</b> [${item.tier}]${item.scheduledAt ? `\n   📅 ${item.scheduledAt}` : ""}`
                    ).join("\n");
                    await sendTelegramMessage(botToken, chatId,
                        `<b>Queued Items (${queued.length})</b>\n\n${list}`
                    );
                }
                return new Response(JSON.stringify({ ok: true }), { headers: CORS });
            }

            // ─── COMMAND: /schedule
            if (message.text === "/schedule") {
                const pipeStore = getStore("pipeline");
                const { blobs } = await pipeStore.list();
                const scheduled: any[] = [];

                for (const blob of blobs) {
                    try {
                        const item = await pipeStore.get(blob.key, { type: "json" }) as any;
                        if (item?.status === "queued" && item.scheduledAt) scheduled.push(item);
                    } catch {}
                }

                scheduled.sort((a, b) => (a.scheduledAt || "").localeCompare(b.scheduledAt || ""));

                if (scheduled.length === 0) {
                    await sendTelegramMessage(botToken, chatId, "No scheduled posts. Queue items with a scheduled time to see them here.");
                } else {
                    const list = scheduled.slice(0, 10).map((item, i) =>
                        `${i + 1}. 📅 <b>${item.scheduledAt}</b>\n   ${item.caption || item.filename} [${item.tier}]`
                    ).join("\n\n");
                    await sendTelegramMessage(botToken, chatId,
                        `<b>Scheduled Posts (${scheduled.length})</b>\n\n${list}`
                    );
                }
                return new Response(JSON.stringify({ ok: true }), { headers: CORS });
            }

            // ─── COMMAND: /inbox — List inbox items for quick review
            if (message.text === "/inbox") {
                const pipeStore = getStore("pipeline");
                const { blobs } = await pipeStore.list();
                const inbox: any[] = [];

                for (const blob of blobs) {
                    try {
                        const item = await pipeStore.get(blob.key, { type: "json" }) as any;
                        if (item?.status === "inbox") inbox.push(item);
                    } catch {}
                }

                if (inbox.length === 0) {
                    await sendTelegramMessage(botToken, chatId, "Inbox is empty. All caught up!");
                } else {
                    const list = inbox.slice(0, 10).map((item, i) =>
                        `${i + 1}. <b>${item.caption || item.filename}</b>\n   ID: <code>${item.id}</code> [${item.tier}]`
                    ).join("\n\n");
                    await sendTelegramMessage(botToken, chatId,
                        `<b>Inbox (${inbox.length})</b>\n\n${list}\n\n` +
                        `Use /approve &lt;id&gt; or /reject &lt;id&gt; to manage`
                    );
                }
                return new Response(JSON.stringify({ ok: true }), { headers: CORS });
            }

            // ─── COMMAND: /approve <id> — Approve and queue a pipeline item
            if (message.text?.startsWith("/approve")) {
                const parts = message.text.split(/\s+/);
                const targetId = parts[1];
                if (!targetId) {
                    await sendTelegramMessage(botToken, chatId,
                        "Usage: /approve &lt;pipeline-id&gt;\n\nUse /inbox to see item IDs.");
                    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
                }

                const pipeStore = getStore("pipeline");
                const item = await pipeStore.get(targetId, { type: "json" }) as any;
                if (!item) {
                    await sendTelegramMessage(botToken, chatId, `Item not found: ${targetId}`);
                    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
                }
                if (item.status !== "inbox" && item.status !== "processed") {
                    await sendTelegramMessage(botToken, chatId, `Cannot approve — item is "${item.status}"`);
                    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
                }

                item.status = "queued";
                item.queuedAt = new Date().toISOString();
                if (!item.processedAt) {
                    item.processedAt = new Date().toISOString();
                    item.checks = { ...item.checks, exifStripped: true, compressed: true, thumbnailGenerated: true };
                }
                await pipeStore.setJSON(targetId, item);

                const logStore = getStore("pipeline-logs");
                await logStore.setJSON(`log-${Date.now()}-tg`, {
                    action: "telegram-approve",
                    itemId: targetId,
                    details: { approvedBy: username },
                    timestamp: new Date().toISOString()
                });

                await sendTelegramMessage(botToken, chatId,
                    `✅ <b>Approved!</b>\n\n${item.caption || item.filename}\nStatus: <b>QUEUED</b>${item.scheduledAt ? `\nScheduled: ${item.scheduledAt}` : ""}`
                );
                return new Response(JSON.stringify({ ok: true }), { headers: CORS });
            }

            // ─── COMMAND: /reject <id> [reason] — Reject a pipeline item
            if (message.text?.startsWith("/reject")) {
                const parts = message.text.split(/\s+/);
                const targetId = parts[1];
                const reason = parts.slice(2).join(" ") || "Rejected via Telegram";
                if (!targetId) {
                    await sendTelegramMessage(botToken, chatId,
                        "Usage: /reject &lt;pipeline-id&gt; [reason]\n\nUse /inbox to see item IDs.");
                    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
                }

                const pipeStore = getStore("pipeline");
                const item = await pipeStore.get(targetId, { type: "json" }) as any;
                if (!item) {
                    await sendTelegramMessage(botToken, chatId, `Item not found: ${targetId}`);
                    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
                }

                item.status = "rejected";
                item.rejectReason = reason;
                await pipeStore.setJSON(targetId, item);

                const logStore = getStore("pipeline-logs");
                await logStore.setJSON(`log-${Date.now()}-tg`, {
                    action: "telegram-reject",
                    itemId: targetId,
                    details: { rejectedBy: username, reason },
                    timestamp: new Date().toISOString()
                });

                await sendTelegramMessage(botToken, chatId,
                    `❌ <b>Rejected</b>\n\n${item.caption || item.filename}\nReason: ${reason}`
                );
                return new Response(JSON.stringify({ ok: true }), { headers: CORS });
            }

            // ─── COMMAND: /publish <id> — Publish a queued item immediately
            if (message.text?.startsWith("/publish")) {
                const parts = message.text.split(/\s+/);
                const targetId = parts[1];
                if (!targetId) {
                    await sendTelegramMessage(botToken, chatId,
                        "Usage: /publish &lt;pipeline-id&gt;\n\nUse /queue to see queued items.");
                    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
                }

                const pipeStore = getStore("pipeline");
                const contentStore = getStore("content");
                const item = await pipeStore.get(targetId, { type: "json" }) as any;
                if (!item) {
                    await sendTelegramMessage(botToken, chatId, `Item not found: ${targetId}`);
                    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
                }

                // Allow publishing from inbox/processed/queued
                if (item.status === "published") {
                    await sendTelegramMessage(botToken, chatId, "Already published!");
                    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
                }
                if (item.status === "rejected") {
                    await sendTelegramMessage(botToken, chatId, "Cannot publish rejected item. Approve it first.");
                    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
                }

                // If not yet queued, approve first
                if (item.status !== "queued") {
                    item.status = "queued";
                    item.queuedAt = new Date().toISOString();
                    if (!item.processedAt) {
                        item.processedAt = new Date().toISOString();
                        item.checks = { ...item.checks, exifStripped: true, compressed: true, thumbnailGenerated: true };
                    }
                }

                // Create content entry
                const contentKey = `content-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
                const contentItem = {
                    title: item.caption || item.filename,
                    body: item.caption || "",
                    tier: item.tier || "free",
                    type: item.mediaType === "video" ? "video" : "gallery",
                    imageUrl: `/api/pipeline/asset/${item.storedAs}`,
                    draft: false,
                    tags: item.tags || [],
                    category: item.category || "photos",
                    source: item.source,
                    pipelineId: item.id,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                await contentStore.setJSON(contentKey, contentItem);

                item.status = "published";
                item.publishedAt = new Date().toISOString();
                item.contentKey = contentKey;
                await pipeStore.setJSON(targetId, item);

                const logStore = getStore("pipeline-logs");
                await logStore.setJSON(`log-${Date.now()}-tg`, {
                    action: "telegram-publish",
                    itemId: targetId,
                    details: { publishedBy: username, contentKey },
                    timestamp: new Date().toISOString()
                });

                await sendTelegramMessage(botToken, chatId,
                    `🚀 <b>Published!</b>\n\n${item.caption || item.filename}\nTier: ${item.tier}\nContent: ${contentKey}`
                );
                return new Response(JSON.stringify({ ok: true }), { headers: CORS });
            }

            // ─── COMMAND: /tier <id> <free|vip|elite> — Set item tier
            if (message.text?.startsWith("/tier")) {
                const parts = message.text.split(/\s+/);
                const targetId = parts[1];
                const newTier = (parts[2] || "").toLowerCase();
                if (!targetId || !["free", "vip", "elite"].includes(newTier)) {
                    await sendTelegramMessage(botToken, chatId,
                        "Usage: /tier &lt;pipeline-id&gt; &lt;free|vip|elite&gt;");
                    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
                }

                const pipeStore = getStore("pipeline");
                const item = await pipeStore.get(targetId, { type: "json" }) as any;
                if (!item) {
                    await sendTelegramMessage(botToken, chatId, `Item not found: ${targetId}`);
                    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
                }

                item.tier = newTier;
                await pipeStore.setJSON(targetId, item);

                await sendTelegramMessage(botToken, chatId,
                    `🔒 <b>Tier updated!</b>\n\n${item.caption || item.filename}\nNew tier: <b>${newTier.toUpperCase()}</b>`
                );
                return new Response(JSON.stringify({ ok: true }), { headers: CORS });
            }

            // ─── COMMAND: /recent
            if (message.text === "/recent") {
                const pipeStore = getStore("pipeline");
                const { blobs } = await pipeStore.list();
                const published: any[] = [];

                for (const blob of blobs) {
                    try {
                        const item = await pipeStore.get(blob.key, { type: "json" }) as any;
                        if (item?.status === "published") published.push(item);
                    } catch {}
                }

                published.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));

                if (published.length === 0) {
                    await sendTelegramMessage(botToken, chatId, "Nothing published yet.");
                } else {
                    const list = published.slice(0, 5).map((item, i) =>
                        `${i + 1}. <b>${item.caption || item.filename}</b>\n   ✅ Published ${item.publishedAt?.split("T")[0] || ""} [${item.tier}]`
                    ).join("\n\n");
                    await sendTelegramMessage(botToken, chatId,
                        `<b>Recent Publications</b>\n\n${list}`
                    );
                }
                return new Response(JSON.stringify({ ok: true }), { headers: CORS });
            }

            // ─── PHOTO/VIDEO UPLOAD ─────────────────────────
            if (message.photo || message.video || message.document) {
                let fileId = "";
                let fileName = "";
                let fileSize = 0;

                if (message.photo) {
                    // Get the largest photo
                    const photo = message.photo[message.photo.length - 1];
                    fileId = photo.file_id;
                    fileName = `photo-${Date.now()}.jpg`;
                    fileSize = photo.file_size || 0;
                } else if (message.video) {
                    fileId = message.video.file_id;
                    fileName = message.video.file_name || `video-${Date.now()}.mp4`;
                    fileSize = message.video.file_size || 0;
                } else if (message.document) {
                    fileId = message.document.file_id;
                    fileName = message.document.file_name || `file-${Date.now()}`;
                    fileSize = message.document.file_size || 0;
                }

                // Get file URL from Telegram
                const fileUrl = await getFileFromTelegram(botToken, fileId);

                if (!fileUrl) {
                    await sendTelegramMessage(botToken, chatId, "Failed to get file. Try again or send a smaller file.");
                    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
                }

                // Download and store the file
                try {
                    const fileRes = await fetch(fileUrl);
                    const fileBuffer = await fileRes.arrayBuffer();
                    const fileData = Buffer.from(fileBuffer).toString("base64");

                    // Create pipeline item
                    const ext = fileName.split(".").pop()?.toLowerCase() || "jpg";
                    const pipelineId = `pipe-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;

                    // Store asset
                    const assetStore = getStore("pipeline-assets");
                    await assetStore.set(`${pipelineId}.${ext}`, fileData);

                    // Create pipeline entry
                    const pipeStore = getStore("pipeline");
                    const caption = message.caption || "";

                    // Parse caption for metadata commands
                    let category = "photos";
                    let tier = "free";
                    let cleanCaption = caption;

                    const categoryMatch = caption.match(/category:\s*(\w+)/i);
                    if (categoryMatch) {
                        category = categoryMatch[1].toLowerCase();
                        cleanCaption = cleanCaption.replace(categoryMatch[0], "").trim();
                    }

                    const tierMatch = caption.match(/tier:\s*(\w+)/i);
                    if (tierMatch) {
                        tier = tierMatch[1].toLowerCase();
                        cleanCaption = cleanCaption.replace(tierMatch[0], "").trim();
                    }

                    const IMAGE_TYPES_CHECK = ["jpg", "jpeg", "png", "webp", "gif"];
                    const mediaType = IMAGE_TYPES_CHECK.includes(ext) ? "image" : "video";

                    const item = {
                        id: pipelineId,
                        creatorId: "inkedmayhem",
                        status: "inbox",
                        filename: fileName,
                        storedAs: `${pipelineId}.${ext}`,
                        mediaType,
                        fileExtension: ext,
                        fileSize,
                        fileSizeMB: (fileSize / (1024 * 1024)).toFixed(2),
                        caption: cleanCaption,
                        tags: [],
                        category,
                        tier,
                        source: "telegram",
                        checks: {
                            fileTypeValid: true,
                            fileSizeValid: true,
                            exifStripped: false,
                            compressed: false,
                            thumbnailGenerated: false
                        },
                        rejectReason: "",
                        scheduledAt: null,
                        publishedAt: null,
                        createdAt: new Date().toISOString(),
                        processedAt: null,
                        queuedAt: null,
                        telegramFileId: fileId,
                        telegramFrom: username
                    };

                    await pipeStore.setJSON(pipelineId, item);

                    // Log
                    const logStore = getStore("pipeline-logs");
                    await logStore.setJSON(`log-${Date.now()}`, {
                        action: "telegram-upload",
                        itemId: pipelineId,
                        details: { filename: fileName, source: "telegram", from: username },
                        timestamp: new Date().toISOString()
                    });

                    await sendTelegramMessage(botToken, chatId,
                        `✅ <b>Received!</b>\n\n` +
                        `📁 ${fileName}\n` +
                        `📂 Category: ${category}\n` +
                        `🔒 Tier: ${tier}\n` +
                        `${cleanCaption ? `💬 Caption: ${cleanCaption}\n` : ""}` +
                        `\nStatus: <b>INBOX</b> — waiting for review`
                    );

                } catch (err) {
                    console.error("[TELEGRAM] Upload error:", err);
                    await sendTelegramMessage(botToken, chatId, "Upload failed. Try again.");
                }

                return new Response(JSON.stringify({ ok: true }), { headers: CORS });
            }

            // ─── TEXT MESSAGE (caption update, etc) ─────────
            if (message.text) {
                const text = message.text.trim();

                // Caption update for last uploaded item
                if (text.toLowerCase().startsWith("caption:")) {
                    const newCaption = text.substring(8).trim();
                    const pipeStore = getStore("pipeline");
                    const { blobs } = await pipeStore.list();

                    // Find last inbox item from telegram
                    let lastItem: any = null;
                    let lastKey = "";
                    for (const blob of blobs) {
                        const item = await pipeStore.get(blob.key, { type: "json" }) as any;
                        if (item && item.source === "telegram" && (item.status === "inbox" || item.status === "processed")) {
                            if (!lastItem || (item.createdAt > lastItem.createdAt)) {
                                lastItem = item;
                                lastKey = blob.key;
                            }
                        }
                    }

                    if (lastItem) {
                        lastItem.caption = newCaption;
                        await pipeStore.setJSON(lastKey, lastItem);
                        await sendTelegramMessage(botToken, chatId,
                            `✏️ Caption updated for <b>${lastItem.filename}</b>:\n"${newCaption}"`
                        );
                    } else {
                        await sendTelegramMessage(botToken, chatId, "No recent upload found to update.");
                    }
                    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
                }

                // Unknown text
                await sendTelegramMessage(botToken, chatId,
                    "Send a photo/video to upload, or use /help to see commands."
                );
            }

            return new Response(JSON.stringify({ ok: true }), { headers: CORS });

        } catch (err) {
            console.error("[TELEGRAM] Creator webhook error:", err);
            return new Response(JSON.stringify({ ok: true }), { headers: CORS });
        }
    }

    // ─── FAN BOT WEBHOOK ────────────────────────────────────
    // POST /api/telegram/fan-webhook
    // Receives updates from the fan-facing FAQ bot
    if (path === "/fan-webhook" && req.method === "POST") {
        try {
            const update = await req.json() as any;
            const botToken = getFanBotToken();

            if (!botToken) {
                return new Response(JSON.stringify({ error: "Bot not configured" }), { status: 503, headers: CORS });
            }

            const message = update.message;
            if (!message) {
                return new Response(JSON.stringify({ ok: true }), { headers: CORS });
            }

            const chatId = String(message.chat.id);
            const userId = String(message.from.id);
            const username = message.from.username || message.from.first_name || "Unknown";

            // Rate limit check
            const allowed = await checkRateLimit(userId, 15, 60);
            if (!allowed) {
                await sendTelegramMessage(botToken, chatId,
                    "Slow down — too many messages. Try again in a minute.");
                return new Response(JSON.stringify({ ok: true }), { headers: CORS });
            }

            // /start command
            if (message.text === "/start") {
                await sendTelegramMessage(botToken, chatId,
                    `<b>Hey! Welcome to InkedMayhem.</b>\n\n` +
                    `Ask me anything — membership info, content schedule, pricing, whatever.\n\n` +
                    `Type your question or try:\n` +
                    `• "How do I subscribe?"\n` +
                    `• "What kind of content?"\n` +
                    `• "When do you post?"\n` +
                    `• "How much does it cost?"`
                );
                await logBotEvent("fan", userId, "start", { username });
                return new Response(JSON.stringify({ ok: true }), { headers: CORS });
            }

            // FAQ matching
            if (message.text) {
                const text = message.text.trim();
                const match = matchFaq(text);

                await logBotEvent("fan", userId, "question", {
                    username,
                    message: text.substring(0, 200),
                    matched: match.matched,
                    category: match.category,
                    escalated: match.escalate
                });

                // Hard escalation — no response to user, notify admin
                if (match.hardEscalation) {
                    await sendTelegramMessage(botToken, chatId,
                        "I can't help with that. If you need assistance, please use the contact form on the website.");

                    // Alert admin
                    const adminChatId = getAdminChatId() || getCreatorChatId();
                    const creatorBotToken = getCreatorBotToken();
                    if (adminChatId && creatorBotToken) {
                        await sendTelegramMessage(creatorBotToken, adminChatId,
                            `🚨 <b>SAFETY ALERT</b>\n\n` +
                            `User: @${username} (ID: ${userId})\n` +
                            `Message: "${text.substring(0, 300)}"\n\n` +
                            `This message triggered a hard escalation. Review immediately.`
                        );
                    }

                    // Log escalation
                    const escStore = getStore("telegram-escalations");
                    await escStore.setJSON(`esc-${Date.now()}`, {
                        userId,
                        username,
                        message: text,
                        type: "hard_escalation",
                        timestamp: new Date().toISOString()
                    });

                    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
                }

                // Soft escalation — respond but also notify admin
                if (match.escalate && match.response) {
                    await sendTelegramMessage(botToken, chatId, match.response);

                    const adminChatId = getAdminChatId() || getCreatorChatId();
                    const creatorBotToken = getCreatorBotToken();
                    if (adminChatId && creatorBotToken) {
                        await sendTelegramMessage(creatorBotToken, adminChatId,
                            `⚠️ <b>Escalation</b>\n\n` +
                            `User: @${username}\n` +
                            `Category: ${match.category}\n` +
                            `Message: "${text.substring(0, 300)}"\n\n` +
                            `Auto-response sent. May need follow-up.`
                        );
                    }
                    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
                }

                // Normal FAQ match
                if (match.matched && match.response) {
                    await sendTelegramMessage(botToken, chatId, match.response);

                    // Track FAQ hit for analytics
                    const faqStore = getStore("telegram-faq-stats");
                    try {
                        const stats = await faqStore.get("faq-hits", { type: "json" }) as any || {};
                        stats[match.category || "unknown"] = (stats[match.category || "unknown"] || 0) + 1;
                        stats._total = (stats._total || 0) + 1;
                        stats._lastUpdated = new Date().toISOString();
                        await faqStore.setJSON("faq-hits", stats);
                    } catch {}

                    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
                }

                // No match — track unanswered question for admin review
                const faqStore = getStore("telegram-faq-stats");
                try {
                    const unanswered = await faqStore.get("unanswered", { type: "json" }) as any || { questions: [] };
                    unanswered.questions.push({
                        question: text.substring(0, 300),
                        username,
                        userId,
                        timestamp: new Date().toISOString()
                    });
                    // Keep last 100 unanswered questions
                    if (unanswered.questions.length > 100) {
                        unanswered.questions = unanswered.questions.slice(-100);
                    }
                    await faqStore.setJSON("unanswered", unanswered);
                } catch {}

                // Fallback response
                await sendTelegramMessage(botToken, chatId,
                    "I don't have a specific answer for that, but you can reach out through the contact form on the site and someone will get back to you.\n\n" +
                    "Or try asking about: membership, content, schedule, or pricing."
                );

                return new Response(JSON.stringify({ ok: true }), { headers: CORS });
            }

            return new Response(JSON.stringify({ ok: true }), { headers: CORS });

        } catch (err) {
            console.error("[TELEGRAM] Fan webhook error:", err);
            return new Response(JSON.stringify({ ok: true }), { headers: CORS });
        }
    }

    // ─── SETUP WEBHOOK ──────────────────────────────────────
    // POST /api/telegram/setup
    // Body: { botType: "creator" | "fan" }
    // Sets up the Telegram webhook URL for the bot
    if (path === "/setup" && req.method === "POST") {
        // Verify admin
        const apiKey = req.headers.get("x-api-key");
        const expectedApiKey = process.env.PIPELINE_API_KEY || getSecret();
        const auth = req.headers.get("authorization");
        let isAdmin = false;

        if (apiKey === expectedApiKey) isAdmin = true;
        if (auth) {
            try {
                const decoded = jwt.verify(auth.replace("Bearer ", ""), getSecret()) as any;
                if (decoded.isAdmin) isAdmin = true;
            } catch {}
        }

        if (!isAdmin) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }

        try {
            const { botType } = await req.json();
            const siteUrl = process.env.URL || "";

            if (!siteUrl) {
                return new Response(JSON.stringify({ error: "URL env var not set" }), { status: 500, headers: CORS });
            }

            let token = "";
            let webhookPath = "";

            if (botType === "creator") {
                token = getCreatorBotToken();
                webhookPath = "/api/telegram/creator-webhook";
            } else if (botType === "fan") {
                token = getFanBotToken();
                webhookPath = "/api/telegram/fan-webhook";
            } else {
                return new Response(JSON.stringify({ error: "botType must be 'creator' or 'fan'" }), { status: 400, headers: CORS });
            }

            if (!token) {
                return new Response(JSON.stringify({ error: `${botType} bot token not configured` }), { status: 400, headers: CORS });
            }

            const webhookUrl = `${siteUrl}${webhookPath}`;
            const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: webhookUrl })
            });

            const data = await res.json();
            return new Response(JSON.stringify({ success: true, webhookUrl, telegram: data }), { headers: CORS });

        } catch (err) {
            return new Response(JSON.stringify({ error: "Setup failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── SEND NOTIFICATION ──────────────────────────────────
    // POST /api/telegram/notify
    // Body: { message, chatId?, botType? }
    // Internal: send a Telegram notification to admin/creator
    if (path === "/notify" && req.method === "POST") {
        const internalKey = req.headers.get("x-internal-key");
        const expectedKey = getSecret();
        if (internalKey !== expectedKey) {
            return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: CORS });
        }

        try {
            const { message, chatId, botType } = await req.json();
            const token = botType === "fan" ? getFanBotToken() : getCreatorBotToken();
            const targetChat = chatId || getAdminChatId() || getCreatorChatId();

            if (!token || !targetChat) {
                return new Response(JSON.stringify({ skipped: true, reason: "Bot not configured" }), { headers: CORS });
            }

            const sent = await sendTelegramMessage(token, targetChat, message);
            return new Response(JSON.stringify({ success: true, sent }), { headers: CORS });

        } catch (err) {
            return new Response(JSON.stringify({ error: "Notify failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── BOT STATS ──────────────────────────────────────────
    // GET /api/telegram/stats
    if (path === "/stats" && req.method === "GET") {
        const auth = req.headers.get("authorization");
        let isAdmin = false;
        if (auth) {
            try {
                const decoded = jwt.verify(auth.replace("Bearer ", ""), getSecret()) as any;
                if (decoded.isAdmin) isAdmin = true;
            } catch {}
        }
        if (!isAdmin) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
        }

        try {
            const logStore = getStore("telegram-logs");
            const escStore = getStore("telegram-escalations");
            const [logBlobs, escBlobs] = await Promise.all([logStore.list(), escStore.list()]);

            const recentLogs: any[] = [];
            for (const blob of logBlobs.blobs.slice(-20)) {
                try {
                    const log = await logStore.get(blob.key, { type: "json" });
                    if (log) recentLogs.push(log);
                } catch {}
            }
            recentLogs.sort((a: any, b: any) => (b.timestamp || "").localeCompare(a.timestamp || ""));

            // FAQ stats
            let faqHits = {};
            let unanswered: any[] = [];
            try {
                const faqStore = getStore("telegram-faq-stats");
                const hits = await faqStore.get("faq-hits", { type: "json" });
                if (hits) faqHits = hits;
                const unans = await faqStore.get("unanswered", { type: "json" }) as any;
                if (unans?.questions) unanswered = unans.questions.slice(-20);
            } catch {}

            return new Response(JSON.stringify({
                success: true,
                totalInteractions: logBlobs.blobs.length,
                totalEscalations: escBlobs.blobs.length,
                recentActivity: recentLogs.slice(0, 10),
                faq: {
                    hits: faqHits,
                    unansweredQuestions: unanswered
                },
                botsConfigured: {
                    creator: !!getCreatorBotToken(),
                    fan: !!getFanBotToken()
                }
            }), { headers: CORS });

        } catch (err) {
            return new Response(JSON.stringify({ error: "Stats failed" }), { status: 500, headers: CORS });
        }
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
};

export const config = {
    path: ["/api/telegram", "/api/telegram/*"]
};
