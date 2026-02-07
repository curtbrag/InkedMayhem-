import { getStore } from "@netlify/blobs";
import jwt from "jsonwebtoken";

export default async (req, context) => {
    if (req.method !== "GET" && req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
    }

    try {
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
            return new Response(JSON.stringify({ error: "Invalid or expired token" }), { status: 401 });
        }

        // Get fresh user data
        const store = getStore("users");
        const userKey = decoded.email.toLowerCase().replace(/[^a-z0-9@._-]/g, '');
        const user = await store.get(userKey, { type: "json" });

        if (!user) {
            return new Response(JSON.stringify({ error: "User not found" }), { status: 404 });
        }

        // Return user profile (without password hash)
        return new Response(JSON.stringify({
            success: true,
            user: {
                email: user.email,
                name: user.name,
                tier: user.tier || "free",
                purchases: user.purchases || [],
                createdAt: user.createdAt
            }
        }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (err) {
        console.error("Profile error:", err);
        return new Response(JSON.stringify({ error: "Server error" }), { status: 500 });
    }
};

export const config = {
    path: "/api/me"
};
