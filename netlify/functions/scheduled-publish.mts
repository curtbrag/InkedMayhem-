import { getStore } from "@netlify/blobs";

// ═══════════════════════════════════════════════════════════════
// SCHEDULED PUBLISHER — Runs on cron to auto-publish queued content
// ═══════════════════════════════════════════════════════════════
// Checks for queued items with scheduledAt <= now and publishes them.
// Also fills empty schedule slots if autoFillSlots is enabled.

export default async (req: Request) => {
    const now = new Date();
    const nowISO = now.toISOString();
    console.log(`[SCHEDULED-PUBLISH] Running at ${nowISO}`);

    try {
        const pipeStore = getStore("pipeline");
        const contentStore = getStore("content");
        const logStore = getStore("pipeline-logs");
        const { blobs } = await pipeStore.list();

        let published = 0;
        let checked = 0;
        const results: Array<{ id: string; filename: string; status: string }> = [];

        for (const blob of blobs) {
            try {
                const item = await pipeStore.get(blob.key, { type: "json" }) as any;
                if (!item || item.status !== "queued") continue;
                checked++;

                // Only publish items with a scheduledAt that has passed
                if (!item.scheduledAt) continue;
                if (item.scheduledAt > nowISO) continue;

                // Publish: create content entry
                const contentKey = `content-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
                const contentItem = {
                    title: item.caption || item.filename,
                    body: item.caption || "",
                    tier: item.tier || "free",
                    type: item.mediaType === "video" ? "video" : "gallery",
                    imageUrl: `/api/pipeline/asset/${item.storedAs}`,
                    draft: false,
                    tags: item.tags || [],
                    category: item.category || "photos",
                    source: item.source,
                    pipelineId: item.id,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };

                await contentStore.setJSON(contentKey, contentItem);

                // Update pipeline item
                item.status = "published";
                item.publishedAt = new Date().toISOString();
                item.contentKey = contentKey;
                await pipeStore.setJSON(blob.key, item);

                published++;
                results.push({ id: item.id, filename: item.filename, status: "published" });

                console.log(`[SCHEDULED-PUBLISH] Published: ${item.filename} (scheduled for ${item.scheduledAt})`);
            } catch (err) {
                console.error(`[SCHEDULED-PUBLISH] Error processing ${blob.key}:`, err);
            }
        }

        // Log the cron run
        await logStore.setJSON(`log-${Date.now()}-cron`, {
            action: "scheduled-publish",
            itemId: "cron",
            details: { published, checked, results },
            timestamp: nowISO
        });

        // Send Telegram notification if anything was published
        if (published > 0) {
            try {
                const siteUrl = Netlify.env.get("URL") || "";
                const secret = Netlify.env.get("JWT_SECRET") || "inkedmayhem-dev-secret-change-me";

                // Notify via Telegram
                const botToken = Netlify.env.get("TELEGRAM_CREATOR_BOT_TOKEN");
                const chatId = Netlify.env.get("TELEGRAM_ADMIN_CHAT_ID") || Netlify.env.get("TELEGRAM_CREATOR_CHAT_ID");

                if (botToken && chatId) {
                    const fileList = results.map(r => `  • ${r.filename}`).join("\n");
                    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            chat_id: chatId,
                            text: `📅 <b>Scheduled Publish</b>\n\n${published} item(s) auto-published:\n${fileList}`,
                            parse_mode: "HTML"
                        })
                    });
                }

                // Notify via email
                if (siteUrl) {
                    await fetch(`${siteUrl}/api/notify`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "x-internal-key": secret
                        },
                        body: JSON.stringify({
                            type: "pipeline_publish",
                            data: {
                                filename: `${published} scheduled items`,
                                tier: "mixed",
                                contentKey: "scheduled-batch"
                            }
                        })
                    });
                }
            } catch (notifyErr) {
                console.error("[SCHEDULED-PUBLISH] Notification failed:", notifyErr);
            }
        }

        console.log(`[SCHEDULED-PUBLISH] Done. Checked ${checked} queued items, published ${published}.`);

    } catch (err) {
        console.error("[SCHEDULED-PUBLISH] Fatal error:", err);
    }
};

// Run every 15 minutes
export const config = {
    schedule: "*/15 * * * *"
};
