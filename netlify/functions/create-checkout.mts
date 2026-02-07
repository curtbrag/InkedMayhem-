import Stripe from "stripe";
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

        const { tier, type, postId } = await req.json();
        const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");

        if (!stripeKey) {
            return new Response(JSON.stringify({ 
                error: "Payment not configured yet. Set STRIPE_SECRET_KEY in Netlify env vars." 
            }), { status: 503 });
        }

        const stripe = new Stripe(stripeKey);
        const siteUrl = Netlify.env.get("URL") || "https://inkedmayhem.netlify.app";

        if (type === "subscription" && TIERS[tier]) {
            // Create subscription checkout
            const session = await stripe.checkout.sessions.create({
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
                    tier: tier
                }
            });

            return new Response(JSON.stringify({ url: session.url }), {
                headers: { "Content-Type": "application/json" }
            });

        } else if (type === "single" && postId) {
            // Pay-per-post checkout
            // TODO: Look up post price from content store
            const session = await stripe.checkout.sessions.create({
                mode: "payment",
                customer_email: decoded.email,
                line_items: [{
                    price_data: {
                        currency: "usd",
                        product_data: { name: `Unlock: ${postId}` },
                        unit_amount: 499 // default $4.99, customize per post
                    },
                    quantity: 1
                }],
                success_url: `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${siteUrl}/#exclusive`,
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
