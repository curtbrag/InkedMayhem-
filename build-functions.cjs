const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "src", "functions");
const outDir = path.join(__dirname, "netlify", "functions");

fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".mts"));

console.log(`Building ${files.length} functions...`);

for (const file of files) {
  const input = path.join(srcDir, file);
  const outFile = file.replace(".mts", ".mjs");
  const output = path.join(outDir, outFile);
  console.log(`  ${file} -> ${outFile}`);
  try {
    esbuild.buildSync({
      entryPoints: [input],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: output,
      target: "node18",
      external: ["sharp"],
    });
  } catch (e) {
    console.error(`FAILED to build ${file}:`, e.message);
    process.exit(1);
  }
}

console.log(`Done. ${files.length} functions built to netlify/functions/`);
