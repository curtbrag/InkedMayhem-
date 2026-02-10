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
                if (!user.purchases) user.purchases = [];
                user.purchases.push({
                    postId: session.metadata.post_id,
                    purchasedAt: new Date().toISOString()
                });
            }

            await store.setJSON(userKey, user);
            break;
        }

        case "customer.subscription.deleted": {
            const sub = event.data.object;
            // Find user by customer ID and downgrade
            const { blobs } = await store.list();
            for (const blob of blobs) {
                try {
                    const user = await store.get(blob.key, { type: "json" });
                    if (user?.stripeCustomerId === sub.customer) {
                        user.tier = "free";
                        user.subscriptionId = null;
                        await store.setJSON(blob.key, user);
                        console.log(`Downgraded ${user.email} to free (subscription cancelled)`);
                        break;
                    }
                } catch {}
            }
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
