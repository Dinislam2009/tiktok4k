import "dotenv/config";
import { Bot, InlineKeyboard, Keyboard } from "grammy";
import { PrismaClient } from "@prisma/client";
import { messages } from "./locales.js";
import { videoQueue } from "./queue.js";
import { getCreditBalance, grantPurchasedCredits, grantReferralBonus, refundVideoUsage, reserveVideoCredit } from "./credits.js";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const prisma = new PrismaClient();
const LOCAL_API_URL = process.env.LOCAL_API_URL || "http://127.0.0.1:8081";
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const LOCAL_API_CONTAINER = process.env.LOCAL_API_CONTAINER || "telegram-bot-api";
const TELEGRAM_SHARED_DIR = process.env.TELEGRAM_SHARED_DIR || "/var/lib/telegram-bot-api";

export const bot = new Bot(BOT_TOKEN, {
  client: { apiRoot: LOCAL_API_URL },
});

const CHANNEL_USERNAME = "@tiktokvideo4k";
const BOT_USERNAME = "tiktokvideo4kbot";
const ADMIN_USERNAME = "D1mawik";
const TEMP_DIR = path.join(process.cwd(), "temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

function findFileRecursive(rootDir: string, targetBaseName: string): string | null {
  const pending: string[] = [rootDir];
  const target = targetBaseName.toLowerCase();

  while (pending.length > 0) {
    const currentDir = pending.shift()!;
    let entries: fs.Dirent[];

    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isFile() && entry.name.toLowerCase() === target) {
        return path.resolve(fullPath);
      }

      if (entry.isDirectory()) pending.push(fullPath);
    }
  }

  return null;
}

function resolveSharedTelegramFile(filePath: string): string | null {
  const normalized = filePath.replace(/^[/\\]+/, "");
  const directCandidate = path.join(TELEGRAM_SHARED_DIR, normalized);

  try {
    if (fs.existsSync(directCandidate) && fs.statSync(directCandidate).isFile()) {
      return path.resolve(directCandidate);
    }
  } catch {
    // Continue with recursive search.
  }

  return findFileRecursive(TELEGRAM_SHARED_DIR, path.basename(normalized));
}

async function copyTelegramFileFromDocker(filePath: string, destPath: string): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("Docker file fallback is currently configured for Windows only");
  }

  if (!BOT_TOKEN) throw new Error("BOT_TOKEN is missing");

  const normalized = filePath.replace(/^[/\\]+/, "");
  const containerSource = `/var/lib/telegram-bot-api/${BOT_TOKEN}/${normalized}`;

  console.log("Shared storage file not visible to Windows; copying directly from Docker:", containerSource);

  try {
    await execFileAsync("docker", ["cp", `${LOCAL_API_CONTAINER}:${containerSource}`, destPath], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
  } catch (error: any) {
    const details = error?.stderr || error?.message || String(error);
    throw new Error(`docker cp failed: ${details}`);
  }

  if (!fs.existsSync(destPath)) {
    throw new Error(`Docker copied no file to: ${destPath}`);
  }

  const size = fs.statSync(destPath).size;
  if (size === 0) throw new Error("Docker copied an empty Telegram file");

  console.log("Telegram file copied from Docker:", destPath, size, "bytes");
}

async function downloadLocalTelegramFile(filePath: string, destPath: string): Promise<void> {
  const maxWaitMs = 15000;
  const retryDelayMs = 500;
  const startedAt = Date.now();
  let localPath: string | null = null;

  while (Date.now() - startedAt < maxWaitMs) {
    localPath = resolveLocalTelegramFile(filePath);
    if (!localPath) localPath = resolveSharedTelegramFile(filePath);
    if (localPath) break;
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }

  if (localPath) {
    console.log("Using Local Bot API file from shared storage:", localPath);
    fs.copyFileSync(localPath, destPath);
  } else {
    await copyTelegramFileFromDocker(filePath, destPath);
  }

  if (!fs.existsSync(destPath)) {
    throw new Error(`Telegram file was not copied: ${filePath}`);
  }

  const size = fs.statSync(destPath).size;
  if (size === 0) throw new Error("Telegram file is empty after download");

  console.log("Telegram file ready:", destPath, size, "bytes");
}
