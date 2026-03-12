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

// src/functions/contact.mts
var CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
var RATE_LIMIT_MAX = 5;
var RATE_LIMIT_WINDOW_MS = 60 * 60 * 1e3;
async function checkRateLimit(ip) {
  const store = getStore("auth-ratelimits");
  const key = `contact-${ip.replace(/[^a-z0-9.:]/gi, "")}`;
  try {
    const record = await store.get(key, { type: "json" });
    if (record) {
      const windowStart = new Date(record.windowStart).getTime();
      if (Date.now() - windowStart < RATE_LIMIT_WINDOW_MS) {
        if (record.count >= RATE_LIMIT_MAX) return false;
        record.count++;
        await store.setJSON(key, record);
        return true;
      }
    }
    await store.setJSON(key, { count: 1, windowStart: (/* @__PURE__ */ new Date()).toISOString() });
    return true;
  } catch {
    return true;
  }
}
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function isSpammy(text) {
  const spamPatterns = [
    /\b(viagra|cialis|casino|lottery|winner|congratulations.*won)\b/i,
    /(http[s]?:\/\/[^\s]+){3,}/i,
    // 3+ URLs
    /(.)\1{10,}/
    // 10+ repeated chars
  ];
  return spamPatterns.some((p) => p.test(text));
}
async function notifyAdmin(type, data) {
  const secret = process.env.JWT_SECRET || "inkedmayhem-dev-secret-change-me";
  const siteUrl = process.env.URL || "https://inkedmayhem.netlify.app";
  try {
    await fetch(`${siteUrl}/api/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-key": secret },
      body: JSON.stringify({ type, data })
    });
  } catch (err) {
    console.error("Notify error:", err);
  }
}
var contact_default = async (req, context) => {
  if (req.method === "OPTIONS") {
    return new Response("", { headers: CORS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
  }
  try {
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-nf-client-connection-ip") || "unknown";
    const allowed = await checkRateLimit(clientIp);
    if (!allowed) {
      return new Response(JSON.stringify({ error: "Too many submissions. Try again later." }), {
        status: 429,
        headers: { ...CORS, "Retry-After": "3600" }
      });
    }
    const { name, email, subject, message, _hp } = await req.json();
    if (_hp) {
      return new Response(JSON.stringify({ success: true }), { headers: CORS });
    }
    if (!name || !email || !message) {
      return new Response(JSON.stringify({ error: "Name, email, and message required" }), { status: 400, headers: CORS });
    }
    if (!isValidEmail(email)) {
      return new Response(JSON.stringify({ error: "Invalid email address" }), { status: 400, headers: CORS });
    }
    if (name.length > 100 || email.length > 200 || message.length > 5e3) {
      return new Response(JSON.stringify({ error: "Input too long" }), { status: 400, headers: CORS });
    }
    if (isSpammy(message) || isSpammy(name)) {
      return new Response(JSON.stringify({ success: true }), { headers: CORS });
    }
    const store = getStore("contacts");
    const key = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    await store.setJSON(key, {
      name,
      email,
      subject: subject || "General",
      message,
      receivedAt: (/* @__PURE__ */ new Date()).toISOString(),
      read: false,
      ip: clientIp
    });
    notifyAdmin("contact_form", { name, email, subject, message });
    return new Response(JSON.stringify({ success: true }), { headers: CORS });
  } catch (err) {
    console.error("Contact error:", err);
    return new Response(JSON.stringify({ error: "Server error" }), { status: 500, headers: CORS });
  }
};
var config = {
  path: "/api/contact"
};
export {
  config,
  contact_default as default
};
