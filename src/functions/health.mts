// Simple health check — no dependencies, no blobs, no imports
// Returns deploy timestamp to verify which version is live

const DEPLOY_ID = "2026-03-12-blobs-rewrite-v2";

export default async (req: Request) => {
    return new Response(JSON.stringify({
        status: "ok",
        deployId: DEPLOY_ID,
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
    }), {
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        }
    });
};

export const config = {
    path: "/api/health"
};
