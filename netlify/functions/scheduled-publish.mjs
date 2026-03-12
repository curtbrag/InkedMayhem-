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

// src/functions/scheduled-publish.mts
var scheduled_publish_default = async (req) => {
  const now = /* @__PURE__ */ new Date();
  const nowISO = now.toISOString();
  console.log(`[SCHEDULED-PUBLISH] Running at ${nowISO}`);
  try {
    const pipeStore = getStore("pipeline");
    const contentStore = getStore("content");
    const logStore = getStore("pipeline-logs");
    const { blobs } = await pipeStore.list();
    let published = 0;
    let checked = 0;
    const results = [];
    for (const blob of blobs) {
      try {
        const item = await pipeStore.get(blob.key, { type: "json" });
        if (!item || item.status !== "queued") continue;
        checked++;
        if (!item.scheduledAt) continue;
        if (item.scheduledAt > nowISO) continue;
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
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        await contentStore.setJSON(contentKey, contentItem);
        item.status = "published";
        item.publishedAt = (/* @__PURE__ */ new Date()).toISOString();
        item.contentKey = contentKey;
        await pipeStore.setJSON(blob.key, item);
        published++;
        results.push({ id: item.id, filename: item.filename, status: "published", tier: item.tier, title: contentItem.title, category: item.category });
        console.log(`[SCHEDULED-PUBLISH] Published: ${item.filename} (scheduled for ${item.scheduledAt})`);
      } catch (err) {
        console.error(`[SCHEDULED-PUBLISH] Error processing ${blob.key}:`, err);
      }
    }
    await logStore.setJSON(`log-${Date.now()}-cron`, {
      action: "scheduled-publish",
      itemId: "cron",
      details: { published, checked, results },
      timestamp: nowISO
    });
    if (published > 0) {
      try {
        const siteUrl = process.env.URL || "";
        const secret = process.env.JWT_SECRET || "inkedmayhem-dev-secret-change-me";
        const botToken = process.env.TELEGRAM_CREATOR_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CREATOR_CHAT_ID;
        if (botToken && chatId) {
          const fileList = results.map((r) => `  \u2022 ${r.filename}`).join("\n");
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: `\u{1F4C5} <b>Scheduled Publish</b>

${published} item(s) auto-published:
${fileList}`,
              parse_mode: "HTML"
            })
          });
        }
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
          for (const r of results) {
            try {
              await fetch(`${siteUrl}/api/notify`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-internal-key": secret
                },
                body: JSON.stringify({
                  type: "content_drop",
                  data: {
                    title: r.title || r.filename,
                    category: r.category || "photos",
                    tier: r.tier || "free"
                  }
                })
              });
            } catch {
            }
          }
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
var config = {
  schedule: "*/15 * * * *"
};
export {
  config,
  scheduled_publish_default as default
};
