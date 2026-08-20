import "dotenv/config";
import { Bot, InlineKeyboard, Keyboard } from "grammy";
import { PrismaClient } from "@prisma/client";
import { messages } from "./locales.js";
import { videoQueue } from "./queue.js";
import { getCreditBalance, grantPurchasedCredits, grantReferralBonus, refundVideoUsage, reserveVideoCredit } from "./credits.js";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();
const LOCAL_API_URL = process.env.LOCAL_API_URL || "http://127.0.0.1:8081";
const BOT_TOKEN = process.env.BOT_TOKEN || "";

export const bot = new Bot(BOT_TOKEN, {
  client: { apiRoot: LOCAL_API_URL },
});

const CHANNEL_USERNAME = "@tiktokvideo4k";
const BOT_USERNAME = "tiktokvideo4kbot";
const ADMIN_USERNAME = "D1mawik";
const TEMP_DIR = path.join(process.cwd(), "temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

/**
 * In Local Bot API mode getFile returns a local file path. With our Docker
 * setup the server's /var/lib/telegram-bot-api is mounted to ./temp, and the
 * server keeps each bot's files inside a bot-token directory. Depending on
 * the server build/version, file_path can be absolute or relative, so try
 * all valid mappings before falling back to the HTTP file endpoint.
 */
function resolveLocalTelegramFile(filePath: string): string | null {
  const normalized = filePath.replace(/^[/\\]+/, "");
  const botId = BOT_TOKEN.split(":")[0];

  const candidates = [
    filePath,
    path.join(TEMP_DIR, normalized),
    path.join(TEMP_DIR, BOT_TOKEN, normalized),
    path.join(TEMP_DIR, botId, normalized),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return path.resolve(candidate);
      }
    } catch {
      // Ignore inaccessible candidates and continue checking the others.
    }
  }

  return null;
}

async function downloadLocalTelegramFile(filePath: string, destPath: string): Promise<void> {
  const localPath = resolveLocalTelegramFile(filePath);

  if (localPath) {
    console.log("Using Local Bot API file directly:", localPath);
    fs.copyFileSync(localPath, destPath);
  } else {
    // Some builds expose the local file through the HTTP endpoint even when
    // getFile returns a relative path. Keep this as a compatibility fallback.
    const url = `${LOCAL_API_URL}/file/bot${BOT_TOKEN}/${filePath}`;
    console.log("Local file path not found; trying HTTP download:", url.replace(BOT_TOKEN, "<BOT_TOKEN>"));

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Local Telegram file download failed: HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
  }

  if (!fs.existsSync(destPath) || fs.statSync(destPath).size === 0) {
    throw new Error("Downloaded Telegram file is empty");
  }

  console.log("Telegram file ready:", destPath, fs.statSync(destPath).size, "bytes");
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
  await ctx.reply(`${messages[lang].referralText}\n\n🔗 ${referralLink}`, { parse_mode: "Markdown" });
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