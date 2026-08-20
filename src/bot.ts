import "dotenv/config";
import { Bot, InlineKeyboard, Keyboard, InputFile } from "grammy";
import { PrismaClient } from "@prisma/client";
import { messages } from "./locales.js";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import http from "http";
import ffmpegInstaller from "ffmpeg-static";

// FFmpeg жолын автоматты түрде орнату
if (ffmpegInstaller) {
  ffmpeg.setFfmpegPath(ffmpegInstaller);
}

const prisma = new PrismaClient();

const LOCAL_API_URL = "http://127.0.0.1:8081";

// Local Telegram Bot API серверіне толық байлау
export const bot = new Bot(process.env.BOT_TOKEN || "", {
  client: {
    apiRoot: LOCAL_API_URL,
  },
});

// grammY барлық сұранысты тек локальды серверге жіберуін қамтамасыз ету
bot.api.config.use(async (prev, method, payload, signal) => {
  return await prev(method, payload, signal);
});

const CHANNEL_USERNAME = "@tiktokvideo4k";
const ADMIN_USERNAME = "D1mawik";

// Уақытша файлдар сақталатын папка
const TEMP_DIR = path.join(process.cwd(), "temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

async function isSubscribed(ctx: any, telegramId: number): Promise<boolean> {
  try {
    const member = await ctx.api.getChatMember(CHANNEL_USERNAME, telegramId);
    return ["creator", "administrator", "member"].includes(member.status);
  } catch (error) {
    console.error("Channel check error:", error);
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

function renderProgressBar(percent: number): string {
  const totalBlocks = 10;
  const filledBlocks = Math.round((percent / 100) * totalBlocks);
  const emptyBlocks = totalBlocks - filledBlocks;
  return "█".repeat(filledBlocks) + "░".repeat(emptyBlocks);
}

bot.command("start", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const username = ctx.from?.username || null;
  const match = ctx.match;

  let user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });

  if (!user) {
    user = await prisma.user.create({
      data: { telegramId: BigInt(telegramId), username, language: "kk" },
    });

    if (match && match.startsWith("ref_")) {
      const referrerTgId = match.replace("ref_", "");
      if (referrerTgId !== String(telegramId)) {
        try {
          await prisma.user.update({
            where: { telegramId: BigInt(referrerTgId) },
            data: { bonusLimit: { increment: 1 } },
          });
        } catch (e) {
          console.error("Referrer bonus error:", e);
        }
      }
    }
  }

  const lang = (user.language as "kk" | "ru") || "kk";
  const hasSubscribed = await isSubscribed(ctx, telegramId);

  if (!hasSubscribed) {
    const checkKeyboard = new InlineKeyboard()
      .url("📢 Каналға өту", `https://t.me/tiktokvideo4k`)
      .row()
      .text(messages[lang].checkSubBtn, "check_subscription");

    return ctx.reply(messages[lang].notSubscribed, {
      parse_mode: "Markdown",
      reply_markup: checkKeyboard,
    });
  }

  await ctx.reply(messages[lang].welcome, {
    parse_mode: "Markdown",
    reply_markup: getMainMenu(lang),
  });
});

bot.callbackQuery("check_subscription", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });

  const lang = (user?.language as "kk" | "ru") || "kk";
  const hasSubscribed = await isSubscribed(ctx, telegramId);

  if (!hasSubscribed) {
    return ctx.answerCallbackQuery({
      text: messages[lang].notSubscribedAlert,
      show_alert: true,
    });
  }

  await ctx.answerCallbackQuery();
  await ctx.deleteMessage().catch(() => {});
  await ctx.reply(messages[lang].welcome, {
    parse_mode: "Markdown",
    reply_markup: getMainMenu(lang),
  });
});

bot.hears(["🎬 4K Видео", "🎬 4K Видео"], async (ctx) => {
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
  const lang = (user?.language as "kk" | "ru") || "kk";
  await ctx.reply(messages[lang].video4kInfo, { parse_mode: "Markdown" });
});

bot.hears(["📜 Правила", "📜 Правила"], async (ctx) => {
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
  const lang = (user?.language as "kk" | "ru") || "kk";
  await ctx.reply(messages[lang].rulesText, { parse_mode: "Markdown" });
});

bot.hears(["⭐ Купить тариф", "⭐ Купить тариф"], async (ctx) => {
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
  const lang = (user?.language as "kk" | "ru") || "kk";

  const buyKeyboard = new InlineKeyboard().url(
    "💬 Төлем жасау (Админге жазу)",
    `https://t.me/${ADMIN_USERNAME}?text=Сәлем! TIKTOK 4K ботынан тариф сатып алғым келеді`
  );

  await ctx.reply(messages[lang].buyTariffText, {
    parse_mode: "Markdown",
    reply_markup: buyKeyboard,
  });
});

bot.hears(["👤 Профиль", "👤 Профиль"], async (ctx) => {
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
  const lang = (user?.language as "kk" | "ru") || "kk";

  const profileText = lang === "kk"
    ? `👤 **СІЗДІҢ ПРОФИЛІҢІЗ**\n\n🆔 Telegram ID: \`${ctx.from.id}\`\n👤 Аты: ${ctx.from.first_name}\n🌐 Тіл: Қазақша 🇰🇿`
    : `👤 **ВАШ ПРОФИЛЬ**\n\n🆔 Telegram ID: \`${ctx.from.id}\`\n👤 Имя: ${ctx.from.first_name}\n🌐 Язык: Русский 🇷🇺`;

  const langKeyboard = new InlineKeyboard()
    .text("🇰🇿 Қазақша", "set_lang_kk")
    .text("🇷🇺 Русский", "set_lang_ru");

  await ctx.reply(profileText, { parse_mode: "Markdown", reply_markup: langKeyboard });
});

bot.callbackQuery(["set_lang_kk", "set_lang_ru"], async (ctx) => {
  const newLang = ctx.callbackQuery.data === "set_lang_kk" ? "kk" : "ru";
  
  await prisma.user.update({
    where: { telegramId: BigInt(ctx.from.id) },
    data: { language: newLang },
  });

  await ctx.answerCallbackQuery({
    text: newLang === "kk" ? "Тіл қазақшаға ауыстырылды! 🇰🇿" : "Язык изменен на русский! 🇷🇺",
  });

  await ctx.reply(messages[newLang].welcome, {
    parse_mode: "Markdown",
    reply_markup: getMainMenu(newLang),
  });
});

bot.hears(["📊 Мой лимит", "📊 Мой лимит"], async (ctx) => {
  const telegramId = ctx.from.id;
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
  const lang = (user?.language as "kk" | "ru") || "kk";

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weeklyUsage = await prisma.usageRecord.count({
    where: {
      userId: user?.id,
      createdAt: { gte: oneWeekAgo },
      status: { in: ["RUNNING", "COMPLETED"] },
    },
  });

  const freeLeft = Math.max(0, 2 - weeklyUsage);
  const bonusCount = user?.bonusLimit || 0;
  const refLink = `https://t.me/tiktokvideo4kbot?start=ref_${telegramId}`;

  const limitText = lang === "kk"
    ? `📊 **СІЗДІҢ БАЛАНСЫҢЫЗ:**\n\n• Осы аптадағы негізгі лимит: **${freeLeft} / 2 видео**\n• Бонустық лимит (достарыңыздан): **+${bonusCount} видео**\n\n🔗 **Сіздің реферальды сілтемеңіз:**\n\`${refLink}\` \n\n🎁 *Әрбір шақырылған дос үшін ботқа кірген сәтте сізге +1 видео лимиті беріледі!*`
    : `📊 **ВАШ БАЛАНС:**\n\n• Основной лимит на неделю: **${freeLeft} / 2 видео**\n• Бонусный лимит (от друзей): **+${bonusCount} видео**\n\n🔗 **Ваша реферальная ссылка:**\n\`${refLink}\` \n\n🎁 *За каждого приглашенного друга вы получаете +1 обработку бесплатно!*`;

  await ctx.reply(limitText, { parse_mode: "Markdown" });
});

// ==========================================
// ВИДЕО ҚАБЫЛДАУ, FFMPEG 4K ЖӘНЕ РЕНДЕР
// ==========================================

bot.on(["message:document", "message:video"], async (ctx) => {
  const telegramId = ctx.from.id;
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
  if (!user) return;

  const lang = (user.language as "kk" | "ru") || "kk";

  if (ctx.message.video && !ctx.message.document) {
    return ctx.reply(
      lang === "kk"
        ? "⚠️ **Видеоны ФАЙЛ ретінде жіберіңіз!**\n\n📎 *Скрепка ➔ 📄 Файл* батырмасын басып жіберіңіз."
        : "⚠️ **Отправляйте видео ФАЙЛОМ!**\n\nПожалуйста, отправьте через 📎 *Скрепку ➔ 📄 Файл*.",
      { parse_mode: "Markdown" }
    );
  }

  const doc = ctx.message.document;
  if (!doc) return;

  const fileName = doc.file_name || "video.mp4";
  const ext = path.extname(fileName).toLowerCase();

  if (![".mp4", ".mov"].includes(ext)) {
    return ctx.reply(
      lang === "kk"
        ? "❌ **Тек MP4 және MOV форматтары қабылданады!**"
        : "❌ **Поддерживаются только форматы MP4 и MOV!**",
      { parse_mode: "Markdown" }
    );
  }

  const fileSizeMB = doc.file_size ? doc.file_size / (1024 * 1024) : 0;
  if (fileSizeMB > 500) {
    return ctx.reply(
      lang === "kk"
        ? "❌ **Файл көлемі 500 МБ-тан аспауы тиіс!**"
        : "❌ **Размер файла не должен превышать 500 МБ!**",
      { parse_mode: "Markdown" }
    );
  }

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weeklyUsage = await prisma.usageRecord.count({
    where: {
      userId: user.id,
      createdAt: { gte: oneWeekAgo },
      status: { in: ["RUNNING", "COMPLETED"] },
    },
  });

  const freeLeft = 2 - weeklyUsage;

  if (freeLeft <= 0 && user.bonusLimit <= 0) {
    return ctx.reply(
      lang === "kk"
        ? "❌ **Осы аптадағы лимитіңіз таусылды!**\n\nКөбірек өңдеу үшін досыңызды шақырыңыз немесе **⭐ Купить тариф** батырмасын басыңыз."
        : "❌ **Ваш бесплатный лимит на эту неделю исчерпан!**\n\nПригласите друга или нажмите **⭐ Купить тариф**.",
      { parse_mode: "Markdown" }
    );
  }

  if (freeLeft <= 0 && user.bonusLimit > 0) {
    await prisma.user.update({
      where: { id: user.id },
      data: { bonusLimit: { decrement: 1 } },
    });
  }

  const usageRecord = await prisma.usageRecord.create({
    data: { userId: user.id, status: "RUNNING" },
  });

  const statusMsg = await ctx.reply(
    lang === "kk"
      ? "⏳ **Видео жүктелуде...**\n[░░░░░░░░░░] 0%"
      : "⏳ **Загрузка видео...**\n[░░░░░░░░░░] 0%",
    { parse_mode: "Markdown" }
  );

  const inputPath = path.join(TEMP_DIR, `in_${usageRecord.id}${ext}`);
  const outputPath = path.join(TEMP_DIR, `out_${usageRecord.id}${ext}`);

  try {
    const file = await ctx.api.getFile(doc.file_id);

    const rawPath = file.file_path || "";
    const possiblePaths = [
      rawPath,
      path.join(process.cwd(), "temp", rawPath),
      path.join(process.cwd(), "temp", path.basename(rawPath)),
    ];

    let sourcePath = possiblePaths.find((p) => p && fs.existsSync(p));

    if (sourcePath) {
      fs.copyFileSync(sourcePath, inputPath);
    } else {
      const fileUrl = `${LOCAL_API_URL}/file/bot${process.env.BOT_TOKEN}/${rawPath}`;
      await new Promise((resolve, reject) => {
        const fileStream = fs.createWriteStream(inputPath);
        http.get(fileUrl, (res) => {
          if (res.statusCode !== 200) {
            return reject(new Error(`Failed to download file, HTTP status code: ${res.statusCode}`));
          }
          res.pipe(fileStream);
          fileStream.on("finish", () => {
            fileStream.close();
            resolve(true);
          });
          fileStream.on("error", reject);
        }).on("error", reject);
      });
    }

    let lastEditTime = Date.now();

    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          "-map 0",
          "-c:v libx264",
          "-crf 18",
          "-preset slow",
          "-pix_fmt yuv420p",
          "-c:a copy",
          "-movflags +faststart",
        ])
        .on("progress", async (progress) => {
          const percent = Math.min(100, Math.max(0, Math.round(progress.percent || 0)));

          if (Date.now() - lastEditTime > 2500) {
            lastEditTime = Date.now();
            const bar = renderProgressBar(percent);
            const text = lang === "kk"
              ? `⏳ **Видео 4K форматына өңделуде...**\n[${bar}] ${percent}%`
              : `⏳ **Обработка видео в 4K...**\n[${bar}] ${percent}%`;

            await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, text, { parse_mode: "Markdown" }).catch(() => {});
          }
        })
        .on("end", resolve)
        .on("error", reject)
        .save(outputPath);
    });

    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      lang === "kk" ? "✅ **Өңдеу аяқталды! Файл жіберілуде...**" : "✅ **Обработка завершена! Отправка файла...**",
      { parse_mode: "Markdown" }
    );

    await ctx.api.sendDocument(
      ctx.chat.id,
      new InputFile(outputPath, `4K_${fileName}`),
      {
        caption: lang === "kk"
          ? "🎉 **Видеоңыз TIKTOK 4K арқылы сәтті өңделді!**\n\n📌 *Ереже бойынша ПК немесе Браузер арқылы жүктеуді ұмытпаңыз.*"
          : "🎉 **Ваше видео успешно обработано через TIKTOK 4K!**\n\n📌 *Не забудьте загрузить через ПК или Браузер.*",
        parse_mode: "Markdown",
        disable_content_type_detection: true,
      }
    );

    await prisma.usageRecord.update({
      where: { id: usageRecord.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

  } catch (error) {
    console.error("Video processing error:", error);
    await prisma.usageRecord.update({
      where: { id: usageRecord.id },
      data: { status: "FAILED" },
    });

    await ctx.reply(
      lang === "kk"
        ? "❌ **Видеоны өңдеу кезінде қателік болды.** Қайтадан көріңіз."
        : "❌ **Произошла ошибка при обработке видео.** Попробуйте еще раз."
    );
  } finally {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  }
});

// Ботты іске қосу
console.log("⏳ Бот іске қосылуда...");

bot.start({
  onStart: () => {
    console.log("🤖 TIKTOK 4K боты сәтті іске қосылды!");
  },
}).catch((err) => {
  console.error("Ботты қосу кезінде қате шықты:", err);
});