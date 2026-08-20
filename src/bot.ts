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

function resolveLocalTelegramFile(filePath: string): string | null {
  const normalized = filePath.replace(/^[/\\]+/, "");
  const directCandidate = path.join(TEMP_DIR, normalized);

  try {
    if (fs.existsSync(directCandidate) && fs.statSync(directCandidate).isFile()) {
      return path.resolve(directCandidate);
    }
  } catch {
    // Continue with recursive search.
  }

  return findFileRecursive(TEMP_DIR, path.basename(normalized));
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

async function isSubscribed(ctx: any, telegramId: number): Promise<boolean> {
  try {
    const member = await ctx.api.getChatMember(CHANNEL_USERNAME, telegramId);
    return ["creator", "administrator", "member"].includes(member.status);
  } catch {
    return false;
  }
}

function getMainMenu(lang: "kk" | "ru") {
  const m = messages[lang].menu;
  return new Keyboard()
    .text(m.video4k).row()
    .text(m.profile).text(m.myLimit).row()
    .text(m.referral).text(m.buyTariff).row()
    .text(m.rules)
    .resized();
}

bot.command("start", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const existingUser = await prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
  const user = existingUser ?? await prisma.user.create({
    data: { telegramId: BigInt(telegramId), username: ctx.from?.username || null, language: "kk" },
  });

  if (!existingUser) {
    const payload = ctx.match.trim();
    if (payload.startsWith("ref_")) {
      const granted = await grantReferralBonus(prisma, user.id, payload.slice(4));
      if (granted) {
        await ctx.reply("🎁 Referral сілтемеңіз тіркелді! Досыңыз алғаш рет кіргені үшін сізге +1 бонус видео берілді.");
      }
    }
  }

  const lang = (user.language as "kk" | "ru") || "kk";
  const hasSubscribed = await isSubscribed(ctx, telegramId);

  if (!hasSubscribed) {
    const checkKeyboard = new InlineKeyboard()
      .url("📢 Каналға өту", "https://t.me/tiktokvideo4k")
      .row()
      .text(messages[lang].checkSubBtn, "check_subscription");

    return ctx.reply(messages[lang].notSubscribed, { parse_mode: "Markdown", reply_markup: checkKeyboard });
  }

  await ctx.reply(messages[lang].welcome, { parse_mode: "Markdown", reply_markup: getMainMenu(lang) });
});

bot.command("grant", async (ctx) => {
  if (ctx.from?.username?.toLowerCase() !== ADMIN_USERNAME.toLowerCase()) return;

  const [telegramIdText, videosText] = ctx.match.trim().split(/\s+/);
  const videos = Number(videosText);
  if (!telegramIdText || ![5, 10, 15].includes(videos)) {
    return ctx.reply("Формат: /grant <telegramId> <5|10|15>");
  }

  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(telegramIdText) } });
  if (!user) return ctx.reply("Қолданушы табылмады.");

  const result = await grantPurchasedCredits(prisma, user.id, videos as 5 | 10 | 15);
  await ctx.reply(`✅ ${videos} ақылы видео қосылды.\nUser: ${telegramIdText}\nPurchase: ${result.purchase.id}`);
});

bot.hears(["🎬 4K Видео"], async (ctx) => {
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
  const lang = (user?.language as "kk" | "ru") || "kk";
  await ctx.reply(messages[lang].video4kInfo, { parse_mode: "Markdown" });
});

bot.hears(["📜 Правила"], async (ctx) => {
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
  const lang = (user?.language as "kk" | "ru") || "kk";
  await ctx.reply(messages[lang].rulesText, { parse_mode: "Markdown" });
});

bot.hears(["💳 Сатып алу", "💳 Купить"], async (ctx) => {
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
  const lang = (user?.language as "kk" | "ru") || "kk";
  const buyKeyboard = new InlineKeyboard().url("💬 Админге жазу", `https://t.me/${ADMIN_USERNAME}`);
  await ctx.reply(messages[lang].buyTariffText, { parse_mode: "Markdown", reply_markup: buyKeyboard });
});

bot.hears(["👥 Дос шақыру", "👥 Пригласить друга"], async (ctx) => {
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
  if (!user) return;
  const lang = (user.language as "kk" | "ru") || "kk";
  const referralLink = `https://t.me/${BOT_USERNAME}?start=ref_${user.referralCode}`;
  const referralText = messages[lang].referralText.replace(/\*\*/g, "");
  await ctx.reply(`${referralText}\n\n🔗 ${referralLink}`);
});

bot.hears(["👤 Профиль"], async (ctx) => {
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
  const lang = (user?.language as "kk" | "ru") || "kk";
  if (!user) return;
  const text = lang === "kk"
    ? `👤 **ПРОФИЛЬ**\n\n🆔 ID: \`${ctx.from.id}\`\n🔗 Referral коды: \`${user.referralCode}\``
    : `👤 **ПРОФИЛЬ**\n\n🆔 ID: \`${ctx.from.id}\`\n🔗 Referral код: \`${user.referralCode}\``;
  await ctx.reply(text, { parse_mode: "Markdown" });
});

bot.hears(["📊 Мой лимит"], async (ctx) => {
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
  if (!user) return;
  const lang = (user.language as "kk" | "ru") || "kk";
  const balance = await getCreditBalance(prisma, user.id);
  await ctx.reply(messages[lang].balanceText(balance.free, balance.referral, balance.purchased, balance.total), { parse_mode: "Markdown" });
});

bot.on(["message:document", "message:video"], async (ctx) => {
  const telegramId = ctx.from.id;
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
  if (!user) return;

  const lang = (user.language as "kk" | "ru") || "kk";
  const doc = ctx.message.document;
  if (!doc) {
    return ctx.reply(lang === "kk" ? "⚠️ **Видеоны ФАЙЛ ретінде жіберіңіз!**" : "⚠️ **Отправляйте видео ФАЙЛОМ!**", { parse_mode: "Markdown" });
  }

  const fileName = doc.file_name || "video.mp4";
  const ext = path.extname(fileName).toLowerCase();
  if (![".mp4", ".mov"].includes(ext)) {
    return ctx.reply(lang === "kk" ? "⚠️ Тек MP4 немесе MOV файл жіберіңіз." : "⚠️ Отправьте файл в формате MP4 или MOV.");
  }

  const reserved = await reserveVideoCredit(prisma, user.id);
  if (!reserved) {
    return ctx.reply(messages[lang].noCredits, { parse_mode: "Markdown" });
  }

  const statusMsg = await ctx.reply(lang === "kk" ? "⏳ **Файл кезекке қосылуда...**" : "⏳ **Добавление в очередь...**", { parse_mode: "Markdown" });
  const inputPath = path.join(TEMP_DIR, `in_${reserved.usageRecordId}${ext}`);
  const outputPath = path.join(TEMP_DIR, `out_${reserved.usageRecordId}${ext}`);

  try {
    const file = await ctx.api.getFile(doc.file_id);
    console.log("Local Bot API getFile succeeded:", file.file_path);

    if (!file.file_path) throw new Error("Local Bot API did not return file_path");

    await downloadLocalTelegramFile(file.file_path, inputPath);

    await videoQueue.add("process-video", {
      chatId: ctx.chat.id,
      statusMsgId: statusMsg.message_id,
      usageRecordId: reserved.usageRecordId,
      inputPath,
      outputPath,
      fileName,
      lang,
    });

    console.log("Video job added to BullMQ:", reserved.usageRecordId);
  } catch (error) {
    console.error("Queue add error:", error);
    await refundVideoUsage(prisma, reserved.usageRecordId);
    await ctx.reply(lang === "kk" ? "❌ **Файлды кезекке қосу мүмкін болмады. Видеоңыз балансыңызға қайтарылды.**" : "❌ **Не удалось добавить файл в очередь. Видео возвращено на ваш баланс.**", { parse_mode: "Markdown" });
  }
});

bot.catch((err) => {
  console.error("Bot error:", err);
});

console.log("⏳ Бот іске қосылуда...");
bot.start({ onStart: () => console.log("🤖 TIKTOK HD боты сәтті іске қосылды!") });