const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(process.cwd(), "temp");
const RETENTION_MS = 24 * 60 * 60 * 1000;
const DRY_RUN = process.env.TELEGRAM_CLEANUP_DRY_RUN === "1";
const CONTAINER = process.env.LOCAL_API_CONTAINER || "telegram-bot-api";

function walk(dir) {
  const result = [];
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else result.push(full);
  }
  return result;
}

function isTelegramDocument(file) {
  const normalized = file.toLowerCase();
  return normalized.includes(`${path.sep}documents${path.sep}`) &&
    /\.(mp4|mov|mkv|avi|webm)$/i.test(file);
}

function cleanupWindowsSharedStorage() {
  const cutoff = Date.now() - RETENTION_MS;
  let removed = 0;

  for (const file of walk(ROOT).filter(isTelegramDocument)) {
    const stat = fs.statSync(file);
    if (stat.mtimeMs >= cutoff) continue;

    if (DRY_RUN) {
      console.log(`[dry-run] would remove: ${file} (${stat.size} bytes)`);
      continue;
    }

    fs.rmSync(file, { force: true });
    removed += 1;
    console.log(`Removed: ${file} (${stat.size} bytes)`);
  }

  return removed;
}

function cleanupDockerOnlyStorage() {
  if (process.platform !== "win32") return;

  try {
    const command = `find /var/lib/telegram-bot-api -type f -path '*/documents/*' -mmin +1440 -print`;
    const output = execFileSync("docker", ["exec", CONTAINER, "sh", "-c", command], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

    if (!output) return;

    for (const file of output.split(/\r?\n/).filter(Boolean)) {
      if (DRY_RUN) {
        console.log(`[dry-run] docker file: ${file}`);
        continue;
      }
      execFileSync("docker", ["exec", CONTAINER, "rm", "-f", file], {
        windowsHide: true,
        stdio: "ignore",
      });
      console.log(`Removed from Docker: ${file}`);
    }
  } catch (error) {
    console.warn("Docker-only cleanup skipped:", error.message || error);
  }
}

console.log(`Telegram storage cleanup started (retention: 24h, dry-run: ${DRY_RUN})`);
const removed = cleanupWindowsSharedStorage();
cleanupDockerOnlyStorage();
console.log(`Telegram storage cleanup finished. Removed from shared storage: ${removed}`);
