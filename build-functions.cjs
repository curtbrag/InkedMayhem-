const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "netlify", "functions");
const outDir = path.join(__dirname, "dist", "functions");

fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".mts"));

console.log(`Building ${files.length} functions...`);

for (const file of files) {
  const input = path.join(srcDir, file);
  const outFile = file.replace(".mts", ".mjs");
  const output = path.join(outDir, outFile);
  console.log(`  ${file} -> ${outFile}`);
  execSync(
    `npx esbuild "${input}" --bundle --platform=node --format=esm --outfile="${output}" --target=node18 --external:sharp`,
    { stdio: "inherit" }
  );
}

console.log(`Done. ${files.length} functions built to dist/functions/`);
