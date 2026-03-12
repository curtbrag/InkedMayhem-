const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "src", "functions");
const outDir = path.join(__dirname, "netlify", "functions");

fs.mkdirSync(outDir, { recursive: true });

// Clean old .mjs files from previous builds
for (const old of fs.readdirSync(outDir).filter((f) => f.endsWith(".mjs"))) {
  fs.unlinkSync(path.join(outDir, old));
}

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".mts"));

// v1 adapter: wraps v2 default export (Request, Context) into v1 handler (event, context)
// This prevents Netlify's v2 pipeline from re-bundling and externalizing dependencies
const V1_ADAPTER = `
;(function() {
  var _orig = module.exports.default;
  if (typeof _orig !== 'function') return;
  module.exports.handler = async function(event, context) {
    var url = event.rawUrl || ('https://' + ((event.headers && event.headers.host) || 'localhost') + (event.path || '/'));
    var init = { method: event.httpMethod || 'GET', headers: event.headers || {} };
    if (event.body) {
      init.body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body;
    }
    var req = new Request(url, init);
    var res = await _orig(req, context);
    var body = await res.text();
    var responseHeaders = {};
    res.headers.forEach(function(v, k) { responseHeaders[k] = v; });
    return { statusCode: res.status, headers: responseHeaders, body: body };
  };
})();
`;

console.log("Building " + files.length + " functions (v1 CommonJS)...");

for (const file of files) {
  const input = path.join(srcDir, file);
  const outFile = file.replace(".mts", ".js");
  const output = path.join(outDir, outFile);
  console.log("  " + file + " -> " + outFile);
  try {
    esbuild.buildSync({
      entryPoints: [input],
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile: output,
      target: "node18",
      external: ["sharp"],
      footer: { js: V1_ADAPTER },
    });
  } catch (e) {
    console.error("FAILED to build " + file + ":", e.message);
    process.exit(1);
  }
}

console.log("Done. " + files.length + " functions built to netlify/functions/");
