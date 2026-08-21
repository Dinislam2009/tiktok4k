import "dotenv/config";
import { Worker } from "bullmq";
import { redisConnection, videoQueue } from "./queue.js";
import { PrismaClient } from "@prisma/client";
import { Bot, InputFile } from "grammy";
import { markVideoProcessing, markVideoDelivering, completeVideoUsage, refundVideoUsage, recoverStaleVideoUsages } from "./credits.js";
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

async function recoverStaleUsages() {
  try {
    const jobs = await videoQueue.getJobs(["waiting", "active", "delayed", "prioritized"]);
    const protectedUsageRecordIds = new Set<string>();
    for (const job of jobs) {
      const usageRecordId = job.data?.usageRecordId;
      if (typeof usageRecordId === "string" && usageRecordId) protectedUsageRecordIds.add(usageRecordId);
    }
    const recovered = await recoverStaleVideoUsages(prisma, 2 * 60 * 60 * 1000, protectedUsageRecordIds);
    if (recovered > 0) console.log(`♻️ STALE USAGES RECOVERED: ${recovered} credit(s) refunded`);
  } catch (error) {
    console.error("❌ STALE USAGE RECOVERY ERROR:", error);
  }
}

void recoverStaleUsages();
setInterval(() => void recoverStaleUsages(), 10 * 60 * 1000);

export const worker = new Worker(
  "video-processing",
  async (job) => {
    const { chatId, usageRecordId, inputPath, outputPath, fileName, lang } = job.data;
    let lastEditTime = Date.now();
    const maxAttempts = Number(job.opts.attempts ?? 1);
    const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

    console.log(`▶️ JOB ACTIVE: ${job.id} | attempt=${job.attemptsMade + 1}/${maxAttempts} | file=${fileName} | usage=${usageRecordId}`);

    try {
      const processing = await markVideoProcessing(prisma, usageRecordId);
      if (!processing || processing.status === "COMPLETED" || processing.status === "FAILED") {
        console.log(`ℹ️ JOB SKIPPED: ${job.id} | usage=${usageRecordId} status=${processing?.status ?? "UNKNOWN"}`);
        return;
      }

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

      await markVideoDelivering(prisma, usageRecordId);

      await bot.api.sendDocument(chatId, new InputFile(outputPath, `HD_${fileName}`), {
        caption: lang === "kk"
          ? "🎉 **Видеоңыз TIKTOK HD арқылы сәтті оңтайландырылды!**\n\n📌 *Браузер немесе ПК арқылы жүктеуді ұмытпаңыз.*"
          : "🎉 **Ваше видео успешно оптимизировано через TIKTOK HD!**\n\n📌 *Не забудьте загрузить через ПК или Браузер.*",
        parse_mode: "Markdown",
      });

      await completeVideoUsage(prisma, usageRecordId);
      console.log(`✅ JOB COMPLETED: ${job.id} | usage=${usageRecordId}`);

      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    } catch (error) {
      console.error(`❌ JOB FAILED: ${job.id} | attempt=${job.attemptsMade + 1}/${maxAttempts}`, error);

      if (!isFinalAttempt) {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        throw error;
      }

      try {
        const refunded = await refundVideoUsage(prisma, usageRecordId);
        console.log(`↩️ FINAL FAILURE SETTLEMENT: usage=${usageRecordId} status=${refunded?.status ?? "UNKNOWN"}`);
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

      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      throw error;
    }
  },
  { connection: redisConnection, concurrency: 2 },
);

worker.on("ready", () => console.log("✅ WORKER READY — Redis connection established"));
worker.on("error", (error) => console.error("❌ WORKER ERROR:", error));
worker.on("closed", () => console.log("🛑 WORKER CLOSED"));
console.log("🚀 Video worker starting...");
