// src/functions/health.mts
var DEPLOY_ID = "2026-03-12-blobs-rewrite-v2";
var health_default = async (req) => {
  return new Response(JSON.stringify({
    status: "ok",
    deployId: DEPLOY_ID,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    nodeVersion: process.version
  }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
};
var config = {
  path: "/api/health"
};
export {
  config,
  health_default as default
};
