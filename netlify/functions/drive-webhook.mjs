// src/functions/lib/blobs.mjs
var SITE_STORE_PREFIX = "site:";
var SIGNED_URL_ACCEPT = "application/json;type=signed-url";
var METADATA_HEADER_INTERNAL = "x-amz-meta-user";
var METADATA_HEADER_EXTERNAL = "netlify-blobs-metadata";
var MAX_RETRY = 5;
var RETRY_DELAY = 5e3;
function b64decode(s) {
  return Buffer.from(s, "base64").toString();
}
function b64encode(s) {
  return Buffer.from(s).toString("base64");
}
function getContext() {
  const raw = globalThis.netlifyBlobsContext || process.env.NETLIFY_BLOBS_CONTEXT;
  if (!raw) return {};
  try {
    return JSON.parse(b64decode(raw));
  } catch {
    return {};
  }
}
async function fetchRetry(url, opts, retries = MAX_RETRY) {
  try {
    const res = await fetch(url, opts);
    if (retries > 0 && (res.status === 429 || res.status >= 500)) {
      const delay = res.headers.get("X-RateLimit-Reset") ? Math.max(Number(res.headers.get("X-RateLimit-Reset")) * 1e3 - Date.now(), 1e3) : RETRY_DELAY;
      await new Promise((r) => setTimeout(r, delay));
      return fetchRetry(url, opts, retries - 1);
    }
    return res;
  } catch (err) {
    if (retries === 0) throw err;
    await new Promise((r) => setTimeout(r, RETRY_DELAY));
    return fetchRetry(url, opts, retries - 1);
  }
}
var BlobClient = class {
  constructor({ apiURL, edgeURL, uncachedEdgeURL, siteID, token }) {
    this.apiURL = apiURL;
    this.edgeURL = edgeURL;
    this.uncachedEdgeURL = uncachedEdgeURL;
    this.siteID = siteID;
    this.token = token;
  }
  async _getRequestInfo({ method, storeName, key, metadata }) {
    const encodedMeta = metadata ? "b64;" + b64encode(JSON.stringify(metadata)) : null;
    let urlPath = `/${this.siteID}`;
    if (storeName) urlPath += `/${storeName}`;
    if (key) urlPath += `/${key}`;
    if (this.edgeURL) {
      const headers = { authorization: `Bearer ${this.token}` };
      if (encodedMeta) headers[METADATA_HEADER_INTERNAL] = encodedMeta;
      return { headers, url: new URL(urlPath, this.edgeURL).toString() };
    }
    const apiHeaders = { authorization: `Bearer ${this.token}` };
    const url = new URL(`/api/v1/blobs${urlPath}`, this.apiURL || "https://api.netlify.com");
    if (storeName === void 0 || key === void 0) {
      return { headers: apiHeaders, url: url.toString() };
    }
    if (encodedMeta) apiHeaders[METADATA_HEADER_EXTERNAL] = encodedMeta;
    if (method === "head" || method === "delete") {
      return { headers: apiHeaders, url: url.toString() };
    }
    const res = await fetch(url.toString(), {
      headers: { ...apiHeaders, accept: SIGNED_URL_ACCEPT },
      method
    });
    if (res.status !== 200) throw new Error(`Blobs API error: ${res.status}`);
    const { url: signedURL } = await res.json();
    const userHeaders = encodedMeta ? { [METADATA_HEADER_INTERNAL]: encodedMeta } : void 0;
    return { headers: userHeaders, url: signedURL };
  }
  async request({ body, key, method, storeName, metadata, headers: extra, parameters }) {
    let url, headers;
    if (parameters && Object.keys(parameters).length) {
      let urlPath = `/${this.siteID}`;
      if (storeName) urlPath += `/${storeName}`;
      if (this.edgeURL) {
        const u = new URL(urlPath, this.edgeURL);
        for (const [k, v] of Object.entries(parameters)) u.searchParams.set(k, v);
        headers = { authorization: `Bearer ${this.token}` };
        url = u.toString();
      } else {
        const u = new URL(`/api/v1/blobs${urlPath}`, this.apiURL || "https://api.netlify.com");
        for (const [k, v] of Object.entries(parameters)) u.searchParams.set(k, v);
        headers = { authorization: `Bearer ${this.token}` };
        url = u.toString();
      }
    } else {
      const info = await this._getRequestInfo({ method, storeName, key, metadata });
      url = info.url;
      headers = info.headers || {};
    }
    const opts = { method, headers: { ...headers, ...extra } };
    if (body !== void 0) {
      opts.body = body;
      if (method === "put") opts.headers["cache-control"] = "max-age=0, stale-while-revalidate=60";
    }
    return fetchRetry(url, opts);
  }
};
var Store = class {
  constructor(client, name) {
    this.client = client;
    this.name = SITE_STORE_PREFIX + name;
  }
  async get(key, options) {
    const res = await this.client.request({ key, method: "get", storeName: this.name });
    if (res.status === 404) return null;
    if (res.status !== 200) throw new Error(`Blobs get error: ${res.status}`);
    const type = options?.type;
    if (type === "json") return res.json();
    if (type === "arrayBuffer") return res.arrayBuffer();
    if (type === "stream") return res.body;
    return res.text();
  }
  async set(key, data, { metadata } = {}) {
    const res = await this.client.request({ body: data, key, metadata, method: "put", storeName: this.name });
    if (res.status !== 200) throw new Error(`Blobs set error: ${res.status}`);
  }
  async setJSON(key, data, { metadata } = {}) {
    const payload = JSON.stringify(data);
    const res = await this.client.request({
      body: payload,
      headers: { "content-type": "application/json" },
      key,
      metadata,
      method: "put",
      storeName: this.name
    });
    if (res.status !== 200) throw new Error(`Blobs setJSON error: ${res.status}`);
  }
  async delete(key) {
    const res = await this.client.request({ key, method: "delete", storeName: this.name });
    if (![200, 204, 404].includes(res.status)) throw new Error(`Blobs delete error: ${res.status}`);
  }
  async list(options = {}) {
    const parameters = {};
    if (options.prefix) parameters.prefix = options.prefix;
    if (options.directories) parameters.directories = "true";
    let allBlobs = [];
    let allDirs = [];
    let cursor = null;
    do {
      const params = { ...parameters };
      if (cursor) params.cursor = cursor;
      const res = await this.client.request({ method: "get", parameters: params, storeName: this.name });
      if (res.status === 404) break;
      if (![200, 204].includes(res.status)) throw new Error(`Blobs list error: ${res.status}`);
      if (res.status === 204) break;
      const page = await res.json();
      allBlobs = allBlobs.concat((page.blobs || []).filter((b) => b.key).map((b) => ({ etag: b.etag, key: b.key })));
      allDirs = allDirs.concat(page.directories || []);
      cursor = page.next_cursor || null;
    } while (cursor);
    return { blobs: allBlobs, directories: allDirs };
  }
  async getMetadata(key) {
    const res = await this.client.request({ key, method: "head", storeName: this.name });
    if (res.status === 404) return null;
    const etag = res.headers?.get("etag") || void 0;
    const metaHeader = res.headers?.get(METADATA_HEADER_EXTERNAL) || res.headers?.get(METADATA_HEADER_INTERNAL);
    let metadata = {};
    if (metaHeader && metaHeader.startsWith("b64;")) {
      try {
        metadata = JSON.parse(b64decode(metaHeader.slice(4)));
      } catch {
      }
    }
    return { etag, metadata };
  }
};
function getStore(input) {
  const ctx = getContext();
  const siteID = ctx.siteID;
  const token = ctx.token;
  if (!siteID || !token) {
    throw new Error("Blobs environment not configured. Missing siteID or token.");
  }
  const name = typeof input === "string" ? input : input.name;
  const client = new BlobClient({
    apiURL: ctx.apiURL,
    edgeURL: ctx.edgeURL,
    uncachedEdgeURL: ctx.uncachedEdgeURL,
    siteID,
    token
  });
  return new Store(client, name);
}

// src/functions/drive-webhook.mts
var CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key, X-Goog-Channel-ID, X-Goog-Resource-State",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
function getSecret() {
  return process.env.JWT_SECRET || "inkedmayhem-dev-secret-change-me";
}
function getPipelineApiKey() {
  return process.env.PIPELINE_API_KEY || getSecret();
}
var ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "mp4", "mov", "webm"];
var IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"];
function getExtension(filename) {
  return (filename.split(".").pop() || "").toLowerCase();
}
function isAllowedFile(filename) {
  return ALLOWED_EXTENSIONS.includes(getExtension(filename));
}
async function createPipelineItem(params) {
  const pipeStore = getStore("pipeline");
  const logStore = getStore("pipeline-logs");
  const ext = getExtension(params.filename);
  const pipelineId = `pipe-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
  if (params.fileData) {
    const assetStore = getStore("pipeline-assets");
    await assetStore.set(`${pipelineId}.${ext}`, params.fileData);
  }
  const item = {
    id: pipelineId,
    creatorId: params.creatorId || "inkedmayhem",
    status: "inbox",
    filename: params.filename,
    storedAs: `${pipelineId}.${ext}`,
    mediaType: IMAGE_EXTENSIONS.includes(ext) ? "image" : "video",
    fileExtension: ext,
    fileSize: params.fileSize,
    fileSizeMB: (params.fileSize / (1024 * 1024)).toFixed(2),
    caption: params.caption || "",
    tags: [],
    category: "photos",
    tier: "free",
    source: params.source,
    sourceId: params.sourceId || "",
    checks: {
      fileTypeValid: true,
      fileSizeValid: params.fileSize < 25 * 1024 * 1024,
      // 25MB for images
      exifStripped: false,
      compressed: false,
      thumbnailGenerated: false
    },
    rejectReason: "",
    scheduledAt: null,
    publishedAt: null,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    processedAt: null,
    queuedAt: null
  };
  await pipeStore.setJSON(pipelineId, item);
  await logStore.setJSON(`log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`, {
    action: `${params.source}-upload`,
    itemId: pipelineId,
    details: { filename: params.filename, source: params.source },
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
  try {
    const botToken = process.env.TELEGRAM_CREATOR_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CREATOR_CHAT_ID;
    if (botToken && chatId) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: `\u{1F4E5} <b>New upload from ${params.source}</b>

\u{1F4C1} ${params.filename}
\u{1F4C2} Added to inbox`,
          parse_mode: "HTML"
        })
      });
    }
  } catch {
  }
  return { pipelineId, item };
}
var drive_webhook_default = async (req, context) => {
  if (req.method === "OPTIONS") {
    return new Response("", { headers: CORS });
  }
  const url = new URL(req.url);
  const path = url.pathname.replace("/api/drive-webhook", "").replace(/\/$/, "") || "";
  if (req.method === "GET" && path === "") {
    const challenge = url.searchParams.get("challenge");
    if (challenge) {
      return new Response(challenge, {
        headers: {
          "Content-Type": "text/plain",
          "X-Content-Type-Options": "nosniff"
        }
      });
    }
    return new Response(JSON.stringify({ status: "Drive webhook endpoint ready" }), { headers: CORS });
  }
  if (path === "/google" && req.method === "POST") {
    const resourceState = req.headers.get("x-goog-resource-state");
    const channelId = req.headers.get("x-goog-channel-id");
    console.log(`[DRIVE-WEBHOOK] Google notification: state=${resourceState}, channel=${channelId}`);
    if (resourceState === "sync") {
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }
    if (resourceState === "change" || resourceState === "update") {
      try {
        const logStore = getStore("pipeline-logs");
        await logStore.setJSON(`log-${Date.now()}-gdrive`, {
          action: "google-drive-notification",
          itemId: channelId || "unknown",
          details: { resourceState, channelId },
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
        const botToken = process.env.TELEGRAM_CREATOR_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CREATOR_CHAT_ID;
        if (botToken && chatId) {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: `\u{1F4C1} <b>Google Drive Update</b>

New files detected in the shared folder. Check the drive and upload to pipeline.`,
              parse_mode: "HTML"
            })
          });
        }
      } catch (err) {
        console.error("[DRIVE-WEBHOOK] Google notification error:", err);
      }
    }
    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
  }
  if (path === "/dropbox" && req.method === "POST") {
    try {
      const body = await req.json();
      const accounts = body.list_folder?.accounts || [];
      console.log(`[DRIVE-WEBHOOK] Dropbox notification: ${accounts.length} accounts changed`);
      const logStore = getStore("pipeline-logs");
      await logStore.setJSON(`log-${Date.now()}-dropbox`, {
        action: "dropbox-notification",
        itemId: "dropbox",
        details: { accountCount: accounts.length },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      const botToken = process.env.TELEGRAM_CREATOR_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CREATOR_CHAT_ID;
      if (botToken && chatId) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: `\u{1F4C1} <b>Dropbox Update</b>

New files detected in the shared folder. Check Dropbox and upload to pipeline.`,
            parse_mode: "HTML"
          })
        });
      }
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    } catch (err) {
      console.error("[DRIVE-WEBHOOK] Dropbox error:", err);
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }
  }
  if (path === "/upload" && req.method === "POST") {
    const apiKey = req.headers.get("x-api-key");
    if (apiKey !== getPipelineApiKey()) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
    }
    try {
      const body = await req.json();
      const { filename, fileSize, fileData, source, caption, creatorId } = body;
      if (!filename || !fileSize) {
        return new Response(JSON.stringify({ error: "filename and fileSize required" }), { status: 400, headers: CORS });
      }
      if (!isAllowedFile(filename)) {
        return new Response(JSON.stringify({
          error: `File type not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`
        }), { status: 400, headers: CORS });
      }
      const result = await createPipelineItem({
        filename,
        fileSize,
        fileData,
        source: source || "api",
        caption,
        creatorId
      });
      return new Response(JSON.stringify({
        success: true,
        pipelineId: result.pipelineId,
        status: "inbox"
      }), { headers: CORS });
    } catch (err) {
      console.error("[DRIVE-WEBHOOK] Upload error:", err);
      return new Response(JSON.stringify({ error: "Upload failed" }), { status: 500, headers: CORS });
    }
  }
  if (path === "/batch-upload" && req.method === "POST") {
    const apiKey = req.headers.get("x-api-key");
    if (apiKey !== getPipelineApiKey()) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
    }
    try {
      const body = await req.json();
      const { files, source, creatorId } = body;
      if (!files || !Array.isArray(files) || files.length === 0) {
        return new Response(JSON.stringify({ error: "files array required" }), { status: 400, headers: CORS });
      }
      const results = [];
      for (const file of files) {
        try {
          if (!isAllowedFile(file.filename)) {
            results.push({ filename: file.filename, error: "File type not allowed" });
            continue;
          }
          const result = await createPipelineItem({
            filename: file.filename,
            fileSize: file.fileSize || 0,
            fileData: file.fileData,
            source: source || "batch",
            caption: file.caption,
            creatorId
          });
          results.push({ filename: file.filename, pipelineId: result.pipelineId });
        } catch (err) {
          results.push({ filename: file.filename, error: "Upload failed" });
        }
      }
      const succeeded = results.filter((r) => r.pipelineId).length;
      return new Response(JSON.stringify({
        success: true,
        total: files.length,
        succeeded,
        failed: files.length - succeeded,
        results
      }), { headers: CORS });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Batch upload failed" }), { status: 500, headers: CORS });
    }
  }
  if (path === "/status" && req.method === "GET") {
    return new Response(JSON.stringify({
      status: "active",
      endpoints: {
        google: "/api/drive-webhook/google",
        dropbox: "/api/drive-webhook/dropbox",
        upload: "/api/drive-webhook/upload",
        batchUpload: "/api/drive-webhook/batch-upload"
      },
      auth: "x-api-key header required for upload endpoints"
    }), { headers: CORS });
  }
  return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
};
var config = {
  path: ["/api/drive-webhook", "/api/drive-webhook/*"]
};
export {
  config,
  drive_webhook_default as default
};
