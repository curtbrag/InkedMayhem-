import Stripe from "stripe";
import { getStore } from "@netlify/blobs";

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
                user.tier = session.metadata.tier || "vip";
                user.stripeCustomerId = session.customer;
                user.subscriptionId = session.subscription;
            } else {
                // Single post purchase
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
            // Find user by subscription ID and downgrade
            // In production, you'd want to index by customer ID
            console.log("Subscription cancelled:", sub.id);
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
