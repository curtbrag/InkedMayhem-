import { getStore } from "@netlify/blobs";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export default async (req, context) => {
    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
    }

    try {
        const { email, password } = await req.json();

        if (!email || !password) {
            return new Response(JSON.stringify({ error: "Email and password required" }), { status: 400 });
        }

        const store = getStore("users");
        const userKey = email.toLowerCase().replace(/[^a-z0-9@._-]/g, '');

        const user = await store.get(userKey, { type: "json" });
        if (!user) {
            return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401 });
        }

        const valid = await bcrypt.compare(password, user.hash);
        if (!valid) {
            return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401 });
        }

        // Track last login
        user.lastLogin = new Date().toISOString();
        await store.setJSON(userKey, user);

        const secret = Netlify.env.get("JWT_SECRET") || "inkedmayhem-dev-secret-change-me";
        const token = jwt.sign({ email: user.email, tier: user.tier }, secret, { expiresIn: "30d" });

        return new Response(JSON.stringify({
            success: true,
            token,
            user: { email: user.email, name: user.name, tier: user.tier }
        }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (err) {
        console.error("Login error:", err);
        return new Response(JSON.stringify({ error: "Server error" }), { status: 500 });
    }
};

export const config = {
    path: "/api/auth-login"
};
