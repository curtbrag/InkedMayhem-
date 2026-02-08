import { getStore } from "@netlify/blobs";

// Lightweight email notification system using Resend API
// Set RESEND_API_KEY and NOTIFY_EMAIL in Netlify env vars

async function sendEmail(to, subject, html) {
    const apiKey = Netlify.env.get("RESEND_API_KEY");
    if (!apiKey) {
        console.log(`[NOTIFY] No RESEND_API_KEY — would send: "${subject}" to ${to}`);
        return false;
    }
    
    try {
        const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                from: "InkedMayhem <notifications@resend.dev>",
                to: [to],
                subject,
                html
            })
        });
        const data = await r.json();
        console.log(`[NOTIFY] Email sent: ${subject}`, data);
        return true;
    } catch (err) {
        console.error("[NOTIFY] Email failed:", err);
        return false;
    }
}

function getAdminEmail() {
    return Netlify.env.get("NOTIFY_EMAIL") || null;
}

function emailTemplate(title, body) {
    return `
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 500px; margin: 0 auto; background: #0a0a0a; color: #e8e4df; padding: 2rem;">
        <h1 style="font-size: 1.5rem; letter-spacing: 3px; border-bottom: 2px solid #c41230; padding-bottom: 0.5rem;">
            INKED<span style="color: #c41230;">MAYHEM</span>
        </h1>
        <h2 style="font-size: 1.1rem; color: #c41230; margin-top: 1.5rem;">${title}</h2>
        <div style="font-size: 0.9rem; line-height: 1.6; color: #bbb;">${body}</div>
        <hr style="border: none; border-top: 1px solid #333; margin: 1.5rem 0;">
        <p style="font-size: 0.7rem; color: #666;">
            <a href="https://inkedmayhem.netlify.app/admin/" style="color: #c41230;">Open Admin Dashboard →</a>
        </p>
    </div>`;
}

// Internal endpoint for other functions to trigger notifications
export default async (req, context) => {
    if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
    }

    // Only allow internal calls (check for internal secret)
    const internalKey = req.headers.get("x-internal-key");
    const expectedKey = Netlify.env.get("JWT_SECRET") || "inkedmayhem-dev-secret-change-me";
    if (internalKey !== expectedKey) {
        return new Response("Forbidden", { status: 403 });
    }

    try {
        const { type, data } = await req.json();
        const adminEmail = getAdminEmail();
        if (!adminEmail) {
            return new Response(JSON.stringify({ skipped: true, reason: "No NOTIFY_EMAIL" }));
        }

        let subject = "";
        let html = "";

        switch (type) {
            case "new_signup":
                subject = `🔥 New member: ${data.name || data.email}`;
                html = emailTemplate("New Member Signed Up", `
                    <p><strong>${data.name || "Unknown"}</strong> just created an account.</p>
                    <p>Email: ${data.email}</p>
                    <p>Time: ${new Date().toLocaleString()}</p>
                `);
                break;

            case "new_message":
                subject = `💬 New message from ${data.from || "a visitor"}`;
                html = emailTemplate("New Message", `
                    <p><strong>From:</strong> ${data.from || "Unknown"}</p>
                    <p><strong>Email:</strong> ${data.email || "N/A"}</p>
                    <p style="background: #1a1a1a; padding: 1rem; border-left: 3px solid #c41230;">
                        ${data.message?.substring(0, 500) || "No message"}
                    </p>
                `);
                break;

            case "new_subscription":
                subject = `💰 New subscriber: ${data.email} → ${data.tier}`;
                html = emailTemplate("New Subscriber! 💰", `
                    <p><strong>${data.email}</strong> just subscribed to <strong>${data.tier}</strong>!</p>
                    <p>Amount: ${data.amount || "N/A"}</p>
                `);
                break;

            case "contact_form":
                subject = `📬 Contact form: ${data.name || data.email}`;
                html = emailTemplate("Contact Form Submission", `
                    <p><strong>Name:</strong> ${data.name || "Unknown"}</p>
                    <p><strong>Email:</strong> ${data.email || "N/A"}</p>
                    <p><strong>Subject:</strong> ${data.subject || "N/A"}</p>
                    <p style="background: #1a1a1a; padding: 1rem; border-left: 3px solid #c41230;">
                        ${data.message?.substring(0, 500) || "No message"}
                    </p>
                `);
                break;

            default:
                return new Response(JSON.stringify({ error: "Unknown type" }), { status: 400 });
        }

        const sent = await sendEmail(adminEmail, subject, html);
        return new Response(JSON.stringify({ success: true, sent }));
    } catch (err) {
        console.error("[NOTIFY] Error:", err);
        return new Response(JSON.stringify({ error: "Notification failed" }), { status: 500 });
    }
};

export const config = {
    path: "/api/notify"
};
