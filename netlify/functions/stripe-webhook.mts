import Stripe from "stripe";
import { getStore } from "@netlify/blobs";

async function notifyAdmin(type, data) {
    const secret = Netlify.env.get("JWT_SECRET") || "inkedmayhem-dev-secret-change-me";
    const siteUrl = Netlify.env.get("URL") || "https://inkedmayhem.netlify.app";
    try {
        await fetch(`${siteUrl}/api/notify`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-internal-key": secret },
            body: JSON.stringify({ type, data })
        });
    } catch {}
}

async function sendTelegramNotification(text) {
    const botToken = Netlify.env.get("TELEGRAM_CREATOR_BOT_TOKEN");
    const chatId = Netlify.env.get("TELEGRAM_ADMIN_CHAT_ID") || Netlify.env.get("TELEGRAM_CREATOR_CHAT_ID");
    if (!botToken || !chatId) return;
    try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" })
        });
    } catch {}
}

async function checkMilestones(store) {
    const { blobs } = await store.list();
    const totalUsers = blobs.length;
    let paidCount = 0;
    for (const blob of blobs) {
        try {
            const u = await store.get(blob.key, { type: "json" });
            if (u?.tier === "vip" || u?.tier === "elite") paidCount++;
        } catch {}
    }

    // Check subscriber milestones
    const milestones = [10, 25, 50, 100, 250, 500, 1000];
    for (const m of milestones) {
        if (totalUsers === m) {
            await sendTelegramNotification(
                `🎉 <b>MILESTONE!</b>\n\n` +
                `You just hit <b>${m} total members!</b>\n` +
                `Keep growing! 🚀`
            );
        }
        if (paidCount === m) {
            await sendTelegramNotification(
                `💰 <b>MILESTONE!</b>\n\n` +
                `You now have <b>${m} paying subscribers!</b>\n` +
                `The hustle is paying off! 🔥`
            );
        }
    }
}

export default async (req, context) => {
    if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
    }

    const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Netlify.env.get("STRIPE_WEBHOOK_SECRET");

    if (!stripeKey || !webhookSecret) {
        return new Response("Not configured", { status: 503 });
    }

    const stripe = new Stripe(stripeKey);
    const body = await req.text();
    const sig = req.headers.get("stripe-signature");

    let event;
    try {
        event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err) {
        console.error("Webhook signature verification failed:", err.message);
        return new Response(`Webhook Error: ${err.message}`, { status: 400 });
    }

    const store = getStore("users");
    const revenueStore = getStore("revenue-events");

    // Helper: find user by Stripe customer ID
    async function findUserByCustomer(customerId) {
        const { blobs } = await store.list();
        for (const blob of blobs) {
            try {
                const user = await store.get(blob.key, { type: "json" });
                if (user?.stripeCustomerId === customerId) {
                    return { key: blob.key, user };
                }
            } catch {}
        }
        return null;
    }

    // Log revenue event for analytics
    async function logRevenue(eventType, data) {
        const key = `rev-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        await revenueStore.setJSON(key, {
            event: eventType,
            ...data,
            timestamp: new Date().toISOString()
        });
    }

    switch (event.type) {
        case "checkout.session.completed": {
            const session = event.data.object;
            const email = session.metadata?.user_email;
            if (!email) break;

            const userKey = email.toLowerCase().replace(/[^a-z0-9@._-]/g, '');
            const user = await store.get(userKey, { type: "json" });
            if (!user) break;

            if (session.mode === "subscription") {
                const tier = session.metadata.tier || "vip";
                user.tier = tier;
                user.stripeCustomerId = session.customer;
                user.subscriptionId = session.subscription;
                user.subscribedAt = new Date().toISOString();

                // Log revenue
                await logRevenue("subscription_created", {
                    email, tier,
                    amount: session.amount_total || 0,
                    currency: session.currency || "usd"
                });

                // Notify admin
                notifyAdmin("new_subscription", {
                    email,
                    tier,
                    amount: session.amount_total ? `$${(session.amount_total / 100).toFixed(2)}` : "N/A"
                });

                // Send welcome email to subscriber
                notifyAdmin("subscriber_welcome", {
                    email,
                    name: user.name,
                    tier
                });

                // Telegram welcome + milestone
                const tierNames = { vip: "Ink Insider", elite: "Mayhem Circle" };
                await sendTelegramNotification(
                    `🔥 <b>New Subscriber!</b>\n\n` +
                    `<b>${user.name || email}</b> just joined <b>${tierNames[tier] || tier.toUpperCase()}</b>!\n` +
                    `💰 ${session.amount_total ? `$${(session.amount_total / 100).toFixed(2)}/mo` : "N/A"}`
                );

                // Check milestones
                try { await checkMilestones(store); } catch {}
            } else {
                // Single post purchase
                if (!user.purchases) user.purchases = [];
                user.purchases.push({
                    postId: session.metadata.post_id,
                    purchasedAt: new Date().toISOString(),
                    amount: session.amount_total || 0
                });

                await logRevenue("single_purchase", {
                    email,
                    postId: session.metadata.post_id,
                    amount: session.amount_total || 0,
                    currency: session.currency || "usd"
                });
            }

            await store.setJSON(userKey, user);
            break;
        }

        case "invoice.payment_succeeded": {
            const invoice = event.data.object;
            // Recurring payment — log revenue
            const email = invoice.customer_email;
            await logRevenue("recurring_payment", {
                email: email || "unknown",
                amount: invoice.amount_paid || 0,
                currency: invoice.currency || "usd",
                invoiceId: invoice.id
            });
            break;
        }

        case "invoice.payment_failed": {
            const invoice = event.data.object;
            const email = invoice.customer_email || "unknown";

            await logRevenue("payment_failed", {
                email,
                amount: invoice.amount_due || 0,
                currency: invoice.currency || "usd",
                invoiceId: invoice.id,
                attemptCount: invoice.attempt_count
            });

            // Notify admin of failed payment
            await sendTelegramNotification(
                `⚠️ <b>Payment Failed!</b>\n\n` +
                `<b>${email}</b>\n` +
                `Amount: $${((invoice.amount_due || 0) / 100).toFixed(2)}\n` +
                `Attempt: ${invoice.attempt_count || 1}`
            );
            break;
        }

        case "customer.subscription.deleted": {
            const sub = event.data.object;
            const found = await findUserByCustomer(sub.customer);
            if (found) {
                found.user.tier = "free";
                found.user.subscriptionId = null;
                found.user.cancelledAt = new Date().toISOString();
                await store.setJSON(found.key, found.user);
                console.log(`Downgraded ${found.user.email} to free (subscription cancelled)`);

                await logRevenue("subscription_cancelled", {
                    email: found.user.email,
                    previousTier: found.user.tier
                });

                await sendTelegramNotification(
                    `📉 <b>Subscription Cancelled</b>\n\n` +
                    `<b>${found.user.name || found.user.email}</b> cancelled their subscription.`
                );
            }
            break;
        }

        case "customer.subscription.updated": {
            const sub = event.data.object;
            const found = await findUserByCustomer(sub.customer);
            if (found) {
                // Update subscription status
                if (sub.cancel_at_period_end) {
                    found.user.cancelPending = true;
                    found.user.cancelAt = sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null;
                } else {
                    found.user.cancelPending = false;
                    found.user.cancelAt = null;
                }
                await store.setJSON(found.key, found.user);
            }
            break;
        }

        case "charge.refunded": {
            const charge = event.data.object;
            const email = charge.billing_details?.email || charge.receipt_email || "unknown";

            await logRevenue("refund", {
                email,
                amount: charge.amount_refunded || 0,
                currency: charge.currency || "usd",
                chargeId: charge.id
            });

            // Notify admin
            await sendTelegramNotification(
                `💸 <b>Refund Processed</b>\n\n` +
                `<b>${email}</b>\n` +
                `Amount: $${((charge.amount_refunded || 0) / 100).toFixed(2)}`
            );
            break;
        }

        case "charge.dispute.created": {
            const dispute = event.data.object;

            await logRevenue("dispute", {
                amount: dispute.amount || 0,
                currency: dispute.currency || "usd",
                reason: dispute.reason,
                chargeId: dispute.charge
            });

            // Urgent admin notification
            await sendTelegramNotification(
                `🚨 <b>DISPUTE / CHARGEBACK!</b>\n\n` +
                `Amount: $${((dispute.amount || 0) / 100).toFixed(2)}\n` +
                `Reason: ${dispute.reason || "N/A"}\n` +
                `⚡ Check Stripe dashboard immediately!`
            );
            break;
        }
    }

    return new Response(JSON.stringify({ received: true }), {
        headers: { "Content-Type": "application/json" }
    });
};

export const config = {
    path: "/api/stripe-webhook"
};
