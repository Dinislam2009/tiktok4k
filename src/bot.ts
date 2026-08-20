import "dotenv/config";
import { Bot, InlineKeyboard, Keyboard } from "grammy";
import { PrismaClient } from "@prisma/client";
import { messages } from "./locales.js";
import { videoQueue } from "./queue.js";
import fs from "fs";
import path from "path";
import ytDlp from "yt-dlp-exec";
import http from "http";

const prisma = new PrismaClient();
const LOCAL_API_URL = process.env.LOCAL_API_URL || "http://127.0.0.1:8081";

export const bot = new Bot(process.env.BOT_TOKEN || "", {
  client: { apiRoot: LOCAL_API_URL },
});

const CHANNEL_USERNAME = "@tiktokvideo4k";
const ADMIN_USERNAME = "D1mawik";
const TEMP_DIR = path.join(process.cwd(), "temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

function escapeMarkdown(text: string): string {
  return text ? text.replace(/[_*`\[\]]/g, "\\$&") : "";
}

function downloadFileStream(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    http.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP Error: ${res.statusCode}`));
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    }).on("error", (err) => { fs.unlink(destPath, () => {}); reject(err); });
  });
}

async function isSubscribed(ctx: any, telegramId: number): Promise<boolean> {
  try {
    const member = await ctx.api.getChatMember(CHANNEL_USERNAME, telegramId);
    return ["creator", "administrator", "member"].includes(member.status);
  } catch (error) {
    return false;
  }
}

function getMainMenu(lang: "kk" | "ru") {
  const m = messages[lang].menu;
  return new Keyboard()
    .text(m.video4k).row()
    .text(m.profile).text(m.myLimit).row()
    .text(m.rules).text(m.buyTariff)
    .resized();
}

bot.command("start", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  let user = await prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
  if (!user) {
    user = await prisma.user.create({
      data: { telegramId: BigInt(telegramId), username: ctx.from?.username || null, language: "kk" },
    });
  }

  const lang = (user.language as "kk" | "ru") || "kk";
  const hasSubscribed = await isSubscribed(ctx, telegramId);

  if (!hasSubscribed) {
    const checkKeyboard = new InlineKeyboard()
      .url("📢 Каналға өту", `https://t.me/tiktokvideo4k`)
      .row()
      .text(messages[lang].checkSubBtn, "check_subscription");

    return ctx.reply(messages[lang].notSubscribed, { parse_mode: "Markdown", reply_markup: checkKeyboard });
  }

  await ctx.reply(messages[lang].welcome, { parse_mode: "Markdown", reply_markup: getMainMenu(lang) });
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

bot.hears(["⭐ Купить тариф"], async (ctx) => {
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
  const lang = (user?.language as "kk" | "ru") || "kk";
  const buyKeyboard = new InlineKeyboard().url("💬 Төлем жасау", `https://t.me/${ADMIN_USERNAME}`);
  await ctx.reply(messages[lang].buyTariffText, { parse_mode: "Markdown", reply_markup: buyKeyboard });
});

bot.hears(["👤 Профиль"], async (ctx) => {
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
  const lang = (user?.language as "kk" | "ru") || "kk";
  const text = lang === "kk" ? `👤 **ПРОФИЛЬ**\n\n🆔 ID: \`${ctx.from.id}\`` : `👤 **ПРОФИЛЬ**\n\n🆔 ID: \`${ctx.from.id}\``;
  await ctx.reply(text, { parse_mode: "Markdown" });
});

bot.hears(["📊 Мой лимит"], async (ctx) => {
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
  const lang = (user?.language as "kk" | "ru") || "kk";
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weeklyUsage = await prisma.usageRecord.count({
    where: { userId: user?.id, createdAt: { gte: oneWeekAgo }, status: { in: ["RUNNING", "COMPLETED"] } },
  });
  const freeLeft = Math.max(0, 2 - weeklyUsage);
  const text = lang === "kk" ? `📊 **БАЛАНС:** **${freeLeft} / 2 видео**` : `📊 **БАЛАНС:** **${freeLeft} / 2 видео**`;
  await ctx.reply(text, { parse_mode: "Markdown" });
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
  if (![".mp4", ".mov"].includes(ext)) return;

  const usageRecord = await prisma.usageRecord.create({ data: { userId: user.id, status: "RUNNING" } });
  const statusMsg = await ctx.reply(lang === "kk" ? "⏳ **Файл кезекке қосылуда...**" : "⏳ **Добавление в очередь...**");

  const inputPath = path.join(TEMP_DIR, `in_${usageRecord.id}${ext}`);
  const outputPath = path.join(TEMP_DIR, `out_${usageRecord.id}${ext}`);

  try {
    const file = await ctx.api.getFile(doc.file_id);
    if (!file.file_path) throw new Error("File path error");

    if (fs.existsSync(file.file_path)) {
      fs.copyFileSync(file.file_path, inputPath);
    } else {
      const fileUrl = `${LOCAL_API_URL}/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
      await downloadFileStream(fileUrl, inputPath);
    }

    // Тапсырманы BullMQ кезегіне қосу
    await videoQueue.add("process-video", {
      chatId: ctx.chat.id,
      statusMsgId: statusMsg.message_id,
      usageRecordId: usageRecord.id,
      inputPath,
      outputPath,
      fileName,
      lang,
    });

  } catch (error) {
    console.error("Queue add error:", error);
    await prisma.usageRecord.update({ where: { id: usageRecord.id }, data: { status: "FAILED" } });
  }
});

bot.catch((err) => {
  console.error(`Bot error:`, err);
});

console.log("⏳ Бот іске қосылуда...");
bot.start({ onStart: () => console.log("🤖 TIKTOK HD боты сәтті іске қосылды!") });