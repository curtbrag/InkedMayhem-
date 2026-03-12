// Minimal Netlify Blobs client using raw fetch — zero npm dependencies
// Replaces @netlify/blobs to avoid Netlify's bundler externalizing it

const SITE_STORE_PREFIX = "site:";
const SIGNED_URL_ACCEPT = "application/json;type=signed-url";
const METADATA_HEADER_INTERNAL = "x-amz-meta-user";
const METADATA_HEADER_EXTERNAL = "netlify-blobs-metadata";
const MAX_RETRY = 5;
const RETRY_DELAY = 5000;

function b64decode(s) { return Buffer.from(s, "base64").toString(); }
function b64encode(s) { return Buffer.from(s).toString("base64"); }

function getContext() {
  const raw = globalThis.netlifyBlobsContext || process.env.NETLIFY_BLOBS_CONTEXT;
  if (!raw) return {};
  try { return JSON.parse(b64decode(raw)); } catch { return {}; }
}

async function fetchRetry(url, opts, retries = MAX_RETRY) {
  try {
    const res = await fetch(url, opts);
    if (retries > 0 && (res.status === 429 || res.status >= 500)) {
      const delay = res.headers.get("X-RateLimit-Reset")
        ? Math.max(Number(res.headers.get("X-RateLimit-Reset")) * 1000 - Date.now(), 1000)
        : RETRY_DELAY;
      await new Promise(r => setTimeout(r, delay));
      return fetchRetry(url, opts, retries - 1);
    }
    return res;
  } catch (err) {
    if (retries === 0) throw err;
    await new Promise(r => setTimeout(r, RETRY_DELAY));
    return fetchRetry(url, opts, retries - 1);
  }
}

class BlobClient {
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

    // Edge URL path (Lambda runtime)
    if (this.edgeURL) {
      const headers = { authorization: `Bearer ${this.token}` };
      if (encodedMeta) headers[METADATA_HEADER_INTERNAL] = encodedMeta;
      return { headers, url: new URL(urlPath, this.edgeURL).toString() };
    }

    // API URL path — need signed URL for get/put
    const apiHeaders = { authorization: `Bearer ${this.token}` };
    const url = new URL(`/api/v1/blobs${urlPath}`, this.apiURL || "https://api.netlify.com");

    if (storeName === undefined || key === undefined) {
      return { headers: apiHeaders, url: url.toString() };
    }
    if (encodedMeta) apiHeaders[METADATA_HEADER_EXTERNAL] = encodedMeta;
    if (method === "head" || method === "delete") {
      return { headers: apiHeaders, url: url.toString() };
    }

    // Get signed URL
    const res = await fetch(url.toString(), {
      headers: { ...apiHeaders, accept: SIGNED_URL_ACCEPT },
      method,
    });
    if (res.status !== 200) throw new Error(`Blobs API error: ${res.status}`);
    const { url: signedURL } = await res.json();
    const userHeaders = encodedMeta ? { [METADATA_HEADER_INTERNAL]: encodedMeta } : undefined;
    return { headers: userHeaders, url: signedURL };
  }

  async request({ body, key, method, storeName, metadata, headers: extra, parameters }) {
    let url, headers;
    if (parameters && Object.keys(parameters).length) {
      // List operation — build URL directly
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
    if (body !== undefined) {
      opts.body = body;
      if (method === "put") opts.headers["cache-control"] = "max-age=0, stale-while-revalidate=60";
    }
    return fetchRetry(url, opts);
  }
}

class Store {
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
      storeName: this.name,
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
      allBlobs = allBlobs.concat((page.blobs || []).filter(b => b.key).map(b => ({ etag: b.etag, key: b.key })));
      allDirs = allDirs.concat(page.directories || []);
      cursor = page.next_cursor || null;
    } while (cursor);

    return { blobs: allBlobs, directories: allDirs };
  }

  async getMetadata(key) {
    const res = await this.client.request({ key, method: "head", storeName: this.name });
    if (res.status === 404) return null;
    const etag = res.headers?.get("etag") || undefined;
    const metaHeader = res.headers?.get(METADATA_HEADER_EXTERNAL) || res.headers?.get(METADATA_HEADER_INTERNAL);
    let metadata = {};
    if (metaHeader && metaHeader.startsWith("b64;")) {
      try { metadata = JSON.parse(b64decode(metaHeader.slice(4))); } catch {}
    }
    return { etag, metadata };
  }
}

export function getStore(input) {
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
    token,
  });
  return new Store(client, name);
}

export function connectLambda(event) {
  const data = JSON.parse(b64decode(event.blobs));
  const ctx = {
    deployID: event.headers["x-nf-deploy-id"],
    edgeURL: data.url,
    siteID: event.headers["x-nf-site-id"],
    token: data.token,
  };
  const encoded = b64encode(JSON.stringify(ctx));
  process.env.NETLIFY_BLOBS_CONTEXT = encoded;
}
