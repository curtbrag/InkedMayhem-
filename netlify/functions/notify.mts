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

        // Subscriber-facing emails go to the subscriber, not admin
        if (type === "subscriber_welcome") {
            if (!data.email) {
                return new Response(JSON.stringify({ skipped: true, reason: "No subscriber email" }));
            }
            const tierNames = { vip: "Ink Insider", elite: "Mayhem Circle" };
            const tierName = tierNames[data.tier] || data.tier?.toUpperCase() || "MEMBER";
            const subject = `Welcome to ${tierName}!`;
            const html = emailTemplate(`Welcome, ${tierName}!`, `
                <p style="font-size: 1.1rem; color: #e8e4df;">Hey ${data.name || "there"},</p>
                <p>You're officially in. Welcome to <strong style="color: #c41230;">${tierName}</strong>.</p>
                <p>Here's what you just unlocked:</p>
                <ul style="color: #bbb; line-height: 2;">
                    ${data.tier === "elite" ? `
                        <li>All VIP + Elite exclusive content</li>
                        <li>Priority messaging with InkedMayhem</li>
                        <li>Early access to new drops</li>
                        <li>Behind-the-scenes content</li>
                    ` : `
                        <li>VIP exclusive content</li>
                        <li>Direct messaging with InkedMayhem</li>
                        <li>New content notifications</li>
                    `}
                </ul>
                <p style="margin-top: 1.5rem;">
                    <a href="https://inkedmayhem.netlify.app/members" style="display:inline-block;background:#c41230;color:#fff;padding:0.75rem 2rem;text-decoration:none;font-family:'Space Mono',monospace;font-size:0.75rem;letter-spacing:2px;text-transform:uppercase;">
                        Access Your Content →
                    </a>
                </p>
                <p style="color: #666; font-size: 0.8rem; margin-top: 1.5rem;">
                    Questions? Just reply to this email or message through the members area.
                </p>
            `);
            const sent = await sendEmail(data.email, subject, html);
            return new Response(JSON.stringify({ success: true, sent }));
        }

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

            case "pipeline_ingest":
                subject = `📥 New content uploaded: ${data.filename || "Unknown file"}`;
                html = emailTemplate("Content Pipeline — New Upload", `
                    <p>New content has been added to the pipeline.</p>
                    <p><strong>File:</strong> ${data.filename || "Unknown"}</p>
                    <p><strong>Source:</strong> ${data.source || "upload"}</p>
                    <p><strong>Pipeline ID:</strong> ${data.pipelineId || "N/A"}</p>
                    <p>Review and approve in the <a href="https://inkedmayhem.netlify.app/admin/" style="color: #c41230;">Admin Dashboard</a>.</p>
                `);
                break;

            case "pipeline_publish":
                subject = `✅ Content published: ${data.filename || "content"}`;
                html = emailTemplate("Content Published", `
                    <p>Content has been published to the site.</p>
                    <p><strong>File:</strong> ${data.filename || "Unknown"}</p>
                    <p><strong>Tier:</strong> ${data.tier || "free"}</p>
                    <p><strong>Content Key:</strong> ${data.contentKey || "N/A"}</p>
                `);
                break;

            case "pipeline_error":
                subject = `⚠️ Pipeline error: ${data.error || "Unknown error"}`;
                html = emailTemplate("Pipeline Error", `
                    <p>An error occurred in the content pipeline.</p>
                    <p><strong>Error:</strong> ${data.error || "Unknown"}</p>
                    <p><strong>Item:</strong> ${data.pipelineId || "N/A"}</p>
                    <p><strong>Details:</strong> ${data.details || "No additional details"}</p>
                `);
                break;

            case "content_drop":
                subject = `New drop from InkedMayhem!`;
                html = emailTemplate("New Content Drop", `
                    <p style="font-size: 1.1rem; color: #e8e4df;">New content just dropped.</p>
                    <p><strong>${data.title || "New content"}</strong></p>
                    ${data.category ? `<p style="color: #c41230; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 2px;">${data.category}</p>` : ""}
                    ${data.tier && data.tier !== "free" ? `<p style="color: #c9a84c; font-size: 0.8rem;">Tier: ${data.tier.toUpperCase()}</p>` : ""}
                    <p style="margin-top: 1.5rem;">
                        <a href="https://inkedmayhem.netlify.app/members" style="display:inline-block;background:#c41230;color:#fff;padding:0.75rem 2rem;text-decoration:none;font-family:'Space Mono',monospace;font-size:0.75rem;letter-spacing:2px;text-transform:uppercase;">
                            View Now &rarr;
                        </a>
                    </p>
                `);
                break;

            case "telegram_escalation":
                subject = `🚨 Telegram escalation: ${data.category || "safety"}`;
                html = emailTemplate("Telegram Safety Escalation", `
                    <p style="color: #e63030;"><strong>A message has been flagged for review.</strong></p>
                    <p><strong>User:</strong> ${data.username || "Unknown"}</p>
                    <p><strong>Category:</strong> ${data.category || "N/A"}</p>
                    <p style="background: #1a1a1a; padding: 1rem; border-left: 3px solid #e63030;">
                        ${(data.message || "").substring(0, 500)}
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
