import { Worker } from "bullmq";
import { redisConnection } from "./queue.js";
import { PrismaClient } from "@prisma/client";
import { Bot, InputFile } from "grammy";
import { completeVideoUsage, refundVideoUsage } from "./credits.js";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "ffmpeg-static";
import fs from "fs";

if (ffmpegInstaller) {
  ffmpeg.setFfmpegPath(ffmpegInstaller);
}

const prisma = new PrismaClient();
const bot = new Bot(process.env.BOT_TOKEN || "", {
  client: { apiRoot: process.env.LOCAL_API_URL || "http://127.0.0.1:8081" },
});

function renderProgressBar(percent: number): string {
  const safePercent = isNaN(percent) ? 0 : Math.min(100, Math.max(0, percent));
  const filledBlocks = Math.round((safePercent / 100) * 10);
  return "█".repeat(filledBlocks) + "░".repeat(10 - filledBlocks);
}

export const worker = new Worker(
  "video-processing",
  async (job) => {
    const { chatId, usageRecordId, inputPath, outputPath, fileName, lang } = job.data;
    let lastEditTime = Date.now();

    try {
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .outputOptions([
            "-map 0",
            "-vf scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,unsharp=5:5:0.8:5:5:0.0",
            "-c:v libx264",
            "-crf 18",
            "-preset slow",
            "-pix_fmt yuv420p",
            "-c:a copy",
            "-movflags +faststart",
          ])
          .on("progress", async (progress) => {
            const percent = Math.min(100, Math.max(0, Math.round(progress.percent || 0)));
            if (Date.now() - lastEditTime > 3000) {
              lastEditTime = Date.now();
              const bar = renderProgressBar(percent);
              const statusText = lang === "kk"
                ? `⏳ **Видео сапасы оңтайландырылуда...**\n[${bar}] ${percent}%`
                : `⏳ **Оптимизация качества видео...**\n[${bar}] ${percent}%`;

              await bot.api.editMessageText(chatId, job.data.statusMsgId, statusText, { parse_mode: "Markdown" }).catch(() => {});
            }
          })
          .on("end", resolve)
          .on("error", reject)
          .save(outputPath);
      });

      await bot.api.sendDocument(chatId, new InputFile(outputPath, `HD_${fileName}`), {
        caption: lang === "kk"
          ? "🎉 **Видеоңыз TIKTOK HD арқылы сәтті оңтайландырылды!**\n\n📌 *Браузер немесе ПК арқылы жүктеуді ұмытпаңыз.*"
          : "🎉 **Ваше видео успешно оптимизировано через TIKTOK HD!**\n\n📌 *Не забудьте загрузить через ПК или Браузер.*",
        parse_mode: "Markdown",
      });

      await completeVideoUsage(prisma, usageRecordId);

    } catch (error) {
      console.error("Worker processing error:", error);
      try {
        await refundVideoUsage(prisma, usageRecordId);
      } catch (refundError) {
        console.error("Credit refund error:", refundError);
      }
      await bot.api.sendMessage(
        chatId,
        lang === "kk"
          ? "❌ **Видео өңдеуде қате шықты. Видеоңыз балансыңызға қайтарылды.**"
          : "❌ **Ошибка при обработке. Видео возвращено на ваш баланс.**",
        { parse_mode: "Markdown" },
      ).catch(() => {});
    } finally {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
  },
  {
    connection: redisConnection,
    concurrency: 2,
  },
);