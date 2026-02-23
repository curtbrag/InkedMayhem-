import { getStore } from "@netlify/blobs";
import jwt from "jsonwebtoken";

// ═══════════════════════════════════════════════════════════════
// ANALYTICS & MONITORING — Health checks, metrics, insights
// ═══════════════════════════════════════════════════════════════
// Provides pipeline health, publish rates, user growth,
// revenue metrics, and system health checks.

const CORS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function getSecret() {
    return process.env.JWT_SECRET || "inkedmayhem-dev-secret-change-me";
}

function verifyAdmin(req: Request) {
    const auth = req.headers.get("authorization");
    if (!auth) return null;
    try {
        const token = auth.replace("Bearer ", "");
        const decoded = jwt.verify(token, getSecret()) as any;
        if (!decoded.isAdmin) return null;
        return decoded;
    } catch { return null; }
}

// ─── Time helpers ────────────────────────────────────────────

function daysAgo(n: number): string {
    return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

function hoursAgo(n: number): string {
    return new Date(Date.now() - n * 60 * 60 * 1000).toISOString();
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════

export default async (req: Request, context: any) => {
    if (req.method === "OPTIONS") {
        return new Response("", { headers: CORS });
    }

    const url = new URL(req.url);
    const path = url.pathname.replace("/api/analytics", "").replace(/\/$/, "") || "";

    // ─── HEALTH CHECK (public, no auth) ─────────────────────
    // GET /api/analytics/health
    if (path === "/health" && req.method === "GET") {
        try {
            const checks: Record<string, any> = {
                status: "ok",
                timestamp: new Date().toISOString(),
                stores: {}
            };

            // Check each critical blob store
            const storeNames = ["pipeline", "users", "content", "pipeline-logs"];
            for (const name of storeNames) {
                try {
                    const store = getStore(name);
                    const { blobs } = await store.list();
                    checks.stores[name] = { ok: true, count: blobs.length };
                } catch (err) {
                    checks.stores[name] = { ok: false, error: String(err) };
                    checks.status = "degraded";
                }
            }

            // Check environment vars
            checks.env = {
                jwtSecret: !!process.env.JWT_SECRET,
                stripeKey: !!process.env.STRIPE_SECRET_KEY,
                telegramCreator: !!process.env.TELEGRAM_CREATOR_BOT_TOKEN,
                telegramFan: !!process.env.TELEGRAM_FAN_BOT_TOKEN,
                resendApi: !!process.env.RESEND_API_KEY,
                notifyEmail: !!process.env.NOTIFY_EMAIL
            };

            const statusCode = checks.status === "ok" ? 200 : 503;
            return new Response(JSON.stringify(checks), { status: statusCode, headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({
                status: "error",
                error: String(err),
                timestamp: new Date().toISOString()
            }), { status: 500, headers: CORS });
        }
    }

    // All routes below require admin auth
    if (!verifyAdmin(req)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
    }

    // ─── DASHBOARD METRICS ──────────────────────────────────
    // GET /api/analytics/dashboard
    // Returns all metrics for the admin analytics view
    if (path === "/dashboard" && req.method === "GET") {
        try {
            const [userMetrics, pipeMetrics, contentMetrics, telegramMetrics] = await Promise.all([
                getUserMetrics(),
                getPipelineMetrics(),
                getContentMetrics(),
                getTelegramMetrics()
            ]);

            return new Response(JSON.stringify({
                success: true,
                generated: new Date().toISOString(),
                users: userMetrics,
                pipeline: pipeMetrics,
                content: contentMetrics,
                telegram: telegramMetrics
            }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Dashboard metrics failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── USER GROWTH ────────────────────────────────────────
    // GET /api/analytics/users
    if (path === "/users" && req.method === "GET") {
        try {
            const metrics = await getUserMetrics();
            return new Response(JSON.stringify({ success: true, ...metrics }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "User metrics failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── PIPELINE METRICS ───────────────────────────────────
    // GET /api/analytics/pipeline
    if (path === "/pipeline" && req.method === "GET") {
        try {
            const metrics = await getPipelineMetrics();
            return new Response(JSON.stringify({ success: true, ...metrics }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Pipeline metrics failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── CONTENT METRICS ────────────────────────────────────
    // GET /api/analytics/content
    if (path === "/content" && req.method === "GET") {
        try {
            const metrics = await getContentMetrics();
            return new Response(JSON.stringify({ success: true, ...metrics }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Content metrics failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── PIPELINE ACTIVITY OVER TIME ────────────────────────
    // GET /api/analytics/activity?days=7
    if (path === "/activity" && req.method === "GET") {
        try {
            const days = parseInt(url.searchParams.get("days") || "7");
            const cutoff = daysAgo(days);
            const logStore = getStore("pipeline-logs");
            const { blobs } = await logStore.list();
            const logs: any[] = [];

            for (const blob of blobs) {
                try {
                    const log = await logStore.get(blob.key, { type: "json" }) as any;
                    if (log && log.timestamp && log.timestamp >= cutoff) {
                        logs.push(log);
                    }
                } catch {}
            }

            // Group by day
            const byDay: Record<string, Record<string, number>> = {};
            for (const log of logs) {
                const day = log.timestamp.split("T")[0];
                if (!byDay[day]) byDay[day] = {};
                byDay[day][log.action] = (byDay[day][log.action] || 0) + 1;
            }

            // Group by action type
            const byAction: Record<string, number> = {};
            for (const log of logs) {
                byAction[log.action] = (byAction[log.action] || 0) + 1;
            }

            return new Response(JSON.stringify({
                success: true,
                days,
                totalEvents: logs.length,
                byDay,
                byAction
            }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Activity metrics failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── ERROR LOG ──────────────────────────────────────────
    // GET /api/analytics/errors?limit=20
    if (path === "/errors" && req.method === "GET") {
        try {
            const limit = parseInt(url.searchParams.get("limit") || "20");
            const logStore = getStore("pipeline-logs");
            const escStore = getStore("telegram-escalations");
            const [logBlobs, escBlobs] = await Promise.all([logStore.list(), escStore.list()]);

            const errors: any[] = [];

            // Pipeline errors
            for (const blob of logBlobs.blobs) {
                try {
                    const log = await logStore.get(blob.key, { type: "json" }) as any;
                    if (log?.action?.includes("error") || log?.action?.includes("fail")) {
                        errors.push({ type: "pipeline", ...log });
                    }
                } catch {}
            }

            // Escalations
            for (const blob of escBlobs.blobs) {
                try {
                    const esc = await escStore.get(blob.key, { type: "json" }) as any;
                    if (esc) errors.push({ type: "escalation", ...esc });
                } catch {}
            }

            errors.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

            return new Response(JSON.stringify({
                success: true,
                errors: errors.slice(0, limit),
                total: errors.length
            }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Error log failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── FAQ INSIGHTS ──────────────────────────────────────────
    // GET /api/analytics/faq
    // Returns FAQ bot stats, top questions, unanswered questions
    if (path === "/faq" && req.method === "GET") {
        try {
            const faqStats = await getFaqInsights();
            return new Response(JSON.stringify({ success: true, ...faqStats }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "FAQ insights failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── REVENUE & SUBSCRIBER ANALYTICS ──────────────────────
    // GET /api/analytics/revenue?days=30
    if (path === "/revenue" && req.method === "GET") {
        try {
            const days = parseInt(url.searchParams.get("days") || "30");
            const revenueMetrics = await getRevenueMetrics(days);
            return new Response(JSON.stringify({ success: true, ...revenueMetrics }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Revenue metrics failed" }), { status: 500, headers: CORS });
        }
    }

    // ─── SUBSCRIBER GROWTH ──────────────────────────────────
    // GET /api/analytics/subscribers?days=90
    if (path === "/subscribers" && req.method === "GET") {
        try {
            const days = parseInt(url.searchParams.get("days") || "90");
            const subMetrics = await getSubscriberMetrics(days);
            return new Response(JSON.stringify({ success: true, ...subMetrics }), { headers: CORS });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Subscriber metrics failed" }), { status: 500, headers: CORS });
        }
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
};

// ═══════════════════════════════════════════════════════════════
// METRIC COLLECTORS
// ═══════════════════════════════════════════════════════════════

async function getUserMetrics() {
    const store = getStore("users");
    const { blobs } = await store.list();
    const tiers: Record<string, number> = { free: 0, vip: 0, elite: 0 };
    const signupsByDay: Record<string, number> = {};
    let totalPurchases = 0;
    let recentSignups7d = 0;
    let recentSignups30d = 0;
    let recentLogins7d = 0;
    const day7 = daysAgo(7);
    const day30 = daysAgo(30);

    for (const blob of blobs) {
        try {
            const user = await store.get(blob.key, { type: "json" }) as any;
            if (!user) continue;
            tiers[user.tier || "free"] = (tiers[user.tier || "free"] || 0) + 1;
            totalPurchases += (user.purchases?.length || 0);

            if (user.createdAt) {
                const day = user.createdAt.split("T")[0];
                signupsByDay[day] = (signupsByDay[day] || 0) + 1;
                if (user.createdAt >= day7) recentSignups7d++;
                if (user.createdAt >= day30) recentSignups30d++;
            }
            if (user.lastLogin && user.lastLogin >= day7) recentLogins7d++;
        } catch {}
    }

    return {
        total: blobs.length,
        tiers,
        signupsByDay,
        recentSignups7d,
        recentSignups30d,
        recentLogins7d,
        totalPurchases,
        paidUsers: (tiers.vip || 0) + (tiers.elite || 0),
        conversionRate: blobs.length > 0
            ? (((tiers.vip || 0) + (tiers.elite || 0)) / blobs.length * 100).toFixed(1) + "%"
            : "0%"
    };
}

async function getPipelineMetrics() {
    const store = getStore("pipeline");
    const { blobs } = await store.list();
    const counts: Record<string, number> = { inbox: 0, processed: 0, queued: 0, published: 0, rejected: 0 };
    const sources: Record<string, number> = {};
    const categories: Record<string, number> = {};
    let totalSizeMB = 0;
    let publishedLast7d = 0;
    let publishedLast30d = 0;
    let avgProcessingTimeMs = 0;
    let processedCount = 0;
    const day7 = daysAgo(7);
    const day30 = daysAgo(30);

    for (const blob of blobs) {
        try {
            const item = await store.get(blob.key, { type: "json" }) as any;
            if (!item) continue;
            counts[item.status] = (counts[item.status] || 0) + 1;
            sources[item.source || "unknown"] = (sources[item.source || "unknown"] || 0) + 1;
            categories[item.category || "uncategorized"] = (categories[item.category || "uncategorized"] || 0) + 1;
            totalSizeMB += parseFloat(item.fileSizeMB || "0");

            if (item.publishedAt) {
                if (item.publishedAt >= day7) publishedLast7d++;
                if (item.publishedAt >= day30) publishedLast30d++;
            }
            if (item.createdAt && item.processedAt) {
                const created = new Date(item.createdAt).getTime();
                const processed = new Date(item.processedAt).getTime();
                if (processed > created) {
                    avgProcessingTimeMs += (processed - created);
                    processedCount++;
                }
            }
        } catch {}
    }

    return {
        total: blobs.length,
        counts,
        sources,
        categories,
        totalSizeMB: totalSizeMB.toFixed(1),
        publishedLast7d,
        publishedLast30d,
        avgProcessingTime: processedCount > 0
            ? Math.round(avgProcessingTimeMs / processedCount / 1000) + "s"
            : "N/A",
        publishRate7d: publishedLast7d > 0
            ? (publishedLast7d / 7).toFixed(1) + "/day"
            : "0/day"
    };
}

async function getContentMetrics() {
    const store = getStore("content");
    const { blobs } = await store.list();
    const tierBreakdown: Record<string, number> = {};
    const typeBreakdown: Record<string, number> = {};
    const categoryBreakdown: Record<string, number> = {};
    let recentContent7d = 0;
    const day7 = daysAgo(7);

    for (const blob of blobs) {
        try {
            const item = await store.get(blob.key, { type: "json" }) as any;
            if (!item) continue;
            tierBreakdown[item.tier || "free"] = (tierBreakdown[item.tier || "free"] || 0) + 1;
            typeBreakdown[item.type || "other"] = (typeBreakdown[item.type || "other"] || 0) + 1;
            categoryBreakdown[item.category || "uncategorized"] = (categoryBreakdown[item.category || "uncategorized"] || 0) + 1;
            if (item.createdAt && item.createdAt >= day7) recentContent7d++;
        } catch {}
    }

    return {
        total: blobs.length,
        tierBreakdown,
        typeBreakdown,
        categoryBreakdown,
        recentContent7d
    };
}

async function getTelegramMetrics() {
    const logStore = getStore("telegram-logs");
    const escStore = getStore("telegram-escalations");
    const [logBlobs, escBlobs] = await Promise.all([logStore.list(), escStore.list()]);

    const actionCounts: Record<string, number> = {};
    const uniqueUsers = new Set<string>();
    let recent24h = 0;
    const h24 = hoursAgo(24);

    for (const blob of logBlobs.blobs) {
        try {
            const log = await logStore.get(blob.key, { type: "json" }) as any;
            if (!log) continue;
            actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;
            if (log.userId) uniqueUsers.add(log.userId);
            if (log.timestamp && log.timestamp >= h24) recent24h++;
        } catch {}
    }

    return {
        totalInteractions: logBlobs.blobs.length,
        totalEscalations: escBlobs.blobs.length,
        uniqueUsers: uniqueUsers.size,
        recent24h,
        actionCounts,
        botsConfigured: {
            creator: !!process.env.TELEGRAM_CREATOR_BOT_TOKEN,
            fan: !!process.env.TELEGRAM_FAN_BOT_TOKEN
        }
    };
}

async function getFaqInsights() {
    const faqStore = getStore("telegram-faq-stats");
    const escStore = getStore("telegram-escalations");

    // Get FAQ hit stats
    const topCategories: Array<{ category: string; hits: number }> = [];
    let totalHits = 0;
    let unansweredQuestions: Array<{ question: string; timestamp: string; userId?: string }> = [];

    try {
        // Get per-category hit counts
        const { blobs: faqBlobs } = await faqStore.list();
        for (const blob of faqBlobs) {
            try {
                const stat = await faqStore.get(blob.key, { type: "json" }) as any;
                if (!stat) continue;

                if (blob.key === "unanswered") {
                    // Unanswered questions log
                    unansweredQuestions = Array.isArray(stat) ? stat : (stat.questions || []);
                } else if (stat.hits !== undefined) {
                    topCategories.push({ category: blob.key, hits: stat.hits || 0 });
                    totalHits += stat.hits || 0;
                }
            } catch {}
        }
    } catch {}

    // Sort categories by hits (most popular first)
    topCategories.sort((a, b) => b.hits - a.hits);

    // Get recent escalations
    const escalations: Array<{ category: string; username: string; message: string; timestamp: string }> = [];
    try {
        const { blobs: escBlobs } = await escStore.list();
        for (const blob of escBlobs.slice(-20)) {
            try {
                const esc = await escStore.get(blob.key, { type: "json" }) as any;
                if (esc) {
                    escalations.push({
                        category: esc.category || "unknown",
                        username: esc.username || "unknown",
                        message: (esc.message || "").substring(0, 200),
                        timestamp: esc.timestamp || blob.key
                    });
                }
            } catch {}
        }
    } catch {}

    escalations.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

    return {
        totalHits,
        topCategories: topCategories.slice(0, 10),
        unansweredQuestions: unansweredQuestions.slice(-20).reverse(),
        unansweredCount: unansweredQuestions.length,
        recentEscalations: escalations.slice(0, 10),
        escalationCount: escalations.length
    };
}

async function getRevenueMetrics(days: number) {
    const revenueStore = getStore("revenue-events");
    const cutoff = daysAgo(days);

    const { blobs } = await revenueStore.list();
    const events: any[] = [];
    let totalRevenue = 0;
    let totalRefunds = 0;
    let failedPayments = 0;
    let disputes = 0;
    const revenueByDay: Record<string, number> = {};
    const revenueByType: Record<string, number> = {};

    for (const blob of blobs) {
        try {
            const ev = await revenueStore.get(blob.key, { type: "json" }) as any;
            if (!ev || !ev.timestamp || ev.timestamp < cutoff) continue;
            events.push(ev);

            const day = ev.timestamp.split("T")[0];
            const amount = (ev.amount || 0) / 100; // Convert cents to dollars

            if (ev.event === "subscription_created" || ev.event === "recurring_payment" || ev.event === "single_purchase") {
                totalRevenue += amount;
                revenueByDay[day] = (revenueByDay[day] || 0) + amount;
                revenueByType[ev.event] = (revenueByType[ev.event] || 0) + amount;
            } else if (ev.event === "refund") {
                totalRefunds += amount;
            } else if (ev.event === "payment_failed") {
                failedPayments++;
            } else if (ev.event === "dispute") {
                disputes++;
            }
        } catch {}
    }

    // Sort revenue by day for chart data
    const sortedDays = Object.entries(revenueByDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, amount]) => ({ date, amount: Math.round(amount * 100) / 100 }));

    return {
        days,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalRefunds: Math.round(totalRefunds * 100) / 100,
        netRevenue: Math.round((totalRevenue - totalRefunds) * 100) / 100,
        failedPayments,
        disputes,
        totalEvents: events.length,
        revenueByDay: sortedDays,
        revenueByType,
        avgDailyRevenue: days > 0 ? Math.round((totalRevenue / days) * 100) / 100 : 0
    };
}

async function getSubscriberMetrics(days: number) {
    const userStore = getStore("users");
    const { blobs } = await userStore.list();
    const cutoff = daysAgo(days);

    const growthByDay: Record<string, { signups: number; cancels: number }> = {};
    let activeVip = 0;
    let activeElite = 0;
    let cancelledInPeriod = 0;
    let newSubsInPeriod = 0;
    const churnDates: string[] = [];

    for (const blob of blobs) {
        try {
            const user = await userStore.get(blob.key, { type: "json" }) as any;
            if (!user) continue;

            if (user.tier === "vip") activeVip++;
            if (user.tier === "elite") activeElite++;

            if (user.subscribedAt && user.subscribedAt >= cutoff) {
                newSubsInPeriod++;
                const day = user.subscribedAt.split("T")[0];
                if (!growthByDay[day]) growthByDay[day] = { signups: 0, cancels: 0 };
                growthByDay[day].signups++;
            }

            if (user.cancelledAt && user.cancelledAt >= cutoff) {
                cancelledInPeriod++;
                churnDates.push(user.cancelledAt);
                const day = user.cancelledAt.split("T")[0];
                if (!growthByDay[day]) growthByDay[day] = { signups: 0, cancels: 0 };
                growthByDay[day].cancels++;
            }
        } catch {}
    }

    const totalPaid = activeVip + activeElite;
    const totalAtStart = totalPaid + cancelledInPeriod - newSubsInPeriod;
    const churnRate = totalAtStart > 0
        ? Math.round((cancelledInPeriod / totalAtStart) * 10000) / 100
        : 0;

    const sortedGrowth = Object.entries(growthByDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, data]) => ({ date, ...data }));

    return {
        days,
        activeVip,
        activeElite,
        totalPaid,
        newSubscribers: newSubsInPeriod,
        cancelled: cancelledInPeriod,
        churnRate: `${churnRate}%`,
        growthByDay: sortedGrowth,
        mrr: Math.round((activeVip * 9.99 + activeElite * 24.99) * 100) / 100
    };
}

export const config = {
    path: ["/api/analytics", "/api/analytics/*"]
};
