import Stripe from "stripe";
import { getStore } from "@netlify/blobs";
import jwt from "jsonwebtoken";

const TIERS = {
    vip: {
        name: "Ink Insider — VIP",
        price: 999, // cents
        interval: "month"
    },
    elite: {
        name: "Mayhem Circle — Elite",
        price: 2499,
        interval: "month"
    }
};

const DEFAULT_POST_PRICE = 499; // $4.99 in cents

export default async (req, context) => {
    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
    }

    try {
        // Verify auth
        const authHeader = req.headers.get("authorization");
        if (!authHeader) {
            return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
        }

        const secret = Netlify.env.get("JWT_SECRET") || "inkedmayhem-dev-secret-change-me";
        const token = authHeader.replace("Bearer ", "");

        let decoded;
        try {
            decoded = jwt.verify(token, secret);
        } catch (e) {
            return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401 });
        }

        const { tier, type, postId, promoCode } = await req.json();
        const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");

        if (!stripeKey) {
            return new Response(JSON.stringify({
                error: "Payment not configured yet. Set STRIPE_SECRET_KEY in Netlify env vars."
            }), { status: 503 });
        }

        const stripe = new Stripe(stripeKey);
        const siteUrl = Netlify.env.get("URL") || "https://inkedmayhem.netlify.app";

        // Check and apply promo code if provided
        let discounts = [];
        if (promoCode) {
            try {
                const promoStore = getStore("promo-codes");
                const promo = await promoStore.get(promoCode.toUpperCase(), { type: "json" });
                if (promo && promo.active && (!promo.expiresAt || promo.expiresAt > new Date().toISOString())) {
                    if (promo.maxUses && promo.usedCount >= promo.maxUses) {
                        return new Response(JSON.stringify({ error: "Promo code has been fully redeemed" }), { status: 400 });
                    }
                    if (promo.stripeCouponId) {
                        discounts = [{ coupon: promo.stripeCouponId }];
                    }
                } else {
                    return new Response(JSON.stringify({ error: "Invalid or expired promo code" }), { status: 400 });
                }
            } catch {
                // Promo code store doesn't exist or code not found — ignore
            }
        }

        if (type === "subscription" && TIERS[tier]) {
            // Create subscription checkout
            const sessionParams: any = {
                mode: "subscription",
                customer_email: decoded.email,
                line_items: [{
                    price_data: {
                        currency: "usd",
                        product_data: { name: TIERS[tier].name },
                        unit_amount: TIERS[tier].price,
                        recurring: { interval: TIERS[tier].interval }
                    },
                    quantity: 1
                }],
                success_url: `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${siteUrl}/#exclusive`,
                metadata: {
                    user_email: decoded.email,
                    tier: tier,
                    promo_code: promoCode || ""
                }
            };
            if (discounts.length) sessionParams.discounts = discounts;

            const session = await stripe.checkout.sessions.create(sessionParams);

            // Track promo code usage
            if (promoCode && discounts.length) {
                try {
                    const promoStore = getStore("promo-codes");
                    const promo = await promoStore.get(promoCode.toUpperCase(), { type: "json" }) as any;
                    if (promo) {
                        promo.usedCount = (promo.usedCount || 0) + 1;
                        promo.usedBy = promo.usedBy || [];
                        promo.usedBy.push({ email: decoded.email, at: new Date().toISOString() });
                        await promoStore.setJSON(promoCode.toUpperCase(), promo);
                    }
                } catch {}
            }

            return new Response(JSON.stringify({ url: session.url }), {
                headers: { "Content-Type": "application/json" }
            });

        } else if (type === "single" && postId) {
            // Pay-per-post checkout — look up price from content store
            let postTitle = `Unlock: ${postId}`;
            let postPrice = DEFAULT_POST_PRICE;

            try {
                const contentStore = getStore("content");
                const post = await contentStore.get(postId, { type: "json" }) as any;
                if (post) {
                    postTitle = `Unlock: ${post.title || postId}`;
                    if (post.price) postPrice = Math.round(post.price * 100); // price stored as dollars
                }
            } catch {}

            // Check if user already purchased this post
            try {
                const userStore = getStore("users");
                const userKey = decoded.email.toLowerCase().replace(/[^a-z0-9@._-]/g, '');
                const user = await userStore.get(userKey, { type: "json" }) as any;
                if (user?.purchases?.some((p: any) => p.postId === postId)) {
                    return new Response(JSON.stringify({ error: "Already purchased", alreadyOwned: true }), { status: 400 });
                }
            } catch {}

            const session = await stripe.checkout.sessions.create({
                mode: "payment",
                customer_email: decoded.email,
                line_items: [{
                    price_data: {
                        currency: "usd",
                        product_data: { name: postTitle },
                        unit_amount: postPrice
                    },
                    quantity: 1
                }],
                success_url: `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${siteUrl}/members`,
                metadata: {
                    user_email: decoded.email,
                    post_id: postId
                }
            });

            return new Response(JSON.stringify({ url: session.url }), {
                headers: { "Content-Type": "application/json" }
            });
        }

        return new Response(JSON.stringify({ error: "Invalid request" }), { status: 400 });

    } catch (err) {
        console.error("Checkout error:", err);
        return new Response(JSON.stringify({ error: "Payment error" }), { status: 500 });
    }
};

export const config = {
    path: "/api/create-checkout"
};
