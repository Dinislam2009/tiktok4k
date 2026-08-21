const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(process.cwd(), "temp");
const RETENTION_MS = Number(process.env.PROCESSING_TEMP_RETENTION_MS || 24 * 60 * 60 * 1000);
const DRY_RUN = process.env.PROCESSING_TEMP_CLEANUP_DRY_RUN === "1";

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else result.push(full);
  }
  return result;
}

const cutoff = Date.now() - RETENTION_MS;
let removed = 0;

for (const file of walk(ROOT)) {
  const name = path.basename(file).toLowerCase();
  if (!/^((in|out)_[0-9a-f-]+)\.(mp4|mov|mkv|avi|webm)$/.test(name)) continue;
  const stat = fs.statSync(file);
  if (stat.mtimeMs >= cutoff) continue;

  if (DRY_RUN) {
    console.log(`[dry-run] would remove: ${file} (${stat.size} bytes)`);
    continue;
  }

  fs.rmSync(file, { force: true });
  removed += 1;
  console.log(`Removed stale processing file: ${file} (${stat.size} bytes)`);
}

console.log(`Processing temp cleanup finished. Removed: ${removed}`);
