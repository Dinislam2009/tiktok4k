import "dotenv/config";
import { Worker } from "bullmq";
import { redisConnection, videoQueue } from "./queue.js";
import { PrismaClient } from "@prisma/client";
import { Bot, InputFile } from "grammy";
import { markVideoProcessing, markVideoDelivering, completeVideoUsage, refundVideoUsage, recoverStaleVideoUsages } from "./credits.js";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "fs";

const execFileAsync = promisify(execFile);

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

function parseFps(value: unknown): number {
  if (typeof value !== "string" || !value) return 0;
  const [num, den] = value.split("/").map(Number);
  if (Number.isFinite(num) && Number.isFinite(den) && den > 0) return num / den;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sameFps(a: number, b: number): boolean {
  return a > 0 && b > 0 && Math.abs(a - b) < 0.01;
}

async function inspectVideo(inputPath: string): Promise<{
  width: number;
  height: number;
  fps: number;
  avgFps: number;
  codec: string;
  format: string;
  hdr: boolean;
  audioCodec: string;
}> {
  const { stdout } = await execFileAsync(ffprobeStatic.path, [
    "-v", "error",
    "-show_entries", "stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,color_transfer,color_primaries,color_space:format=format_name",
    "-of", "json",
    inputPath,
  ]);

  const probe = JSON.parse(stdout) ?? {};
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const stream = streams.find((item: any) => item.codec_type === "video") ?? {};
  const audio = streams.find((item: any) => item.codec_type === "audio") ?? {};
  const fps = parseFps(stream.r_frame_rate);
  const avgFps = parseFps(stream.avg_frame_rate);
  const transfer = String(stream.color_transfer || "").toLowerCase();
  const primaries = String(stream.color_primaries || "").toLowerCase();
  const colorSpace = String(stream.color_space || "").toLowerCase();

  return {
    width: Number(stream.width) || 0,
    height: Number(stream.height) || 0,
    fps,
    avgFps,
    codec: String(stream.codec_name || "").toLowerCase(),
    format: String(probe.format?.format_name || "").toLowerCase(),
    hdr: transfer === "smpte2084" || transfer === "arib-std-b67" || primaries === "bt2020" || colorSpace === "bt2020nc",
    audioCodec: String(audio.codec_name || "").toLowerCase(),
  };
}

function isCompatibleSource(source: Awaited<ReturnType<typeof inspectVideo>>): boolean {
  const videoFps = source.avgFps || source.fps;
  const mp4Like = source.format.split(",").some((name) => name === "mp4" || name === "mov" || name === "3gp" || name === "3g2");
  const dimensionsOk = source.width >= 360 && source.height >= 360 && source.width <= 4096 && source.height <= 4096;
  const fpsOk = videoFps >= 23 && videoFps <= 60;
  const cfrLike = sameFps(source.fps, source.avgFps);

  return source.codec === "h264" && mp4Like && dimensionsOk && fpsOk && cfrLike && !source.hdr;
}

async function remuxSource(inputPath: string, outputPath: string): Promise<void> {
  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-map 0:v:0",
        "-map 0:a:0?",
        "-c copy",
        "-map_metadata -1",
        "-movflags +faststart",
        "-brand isom",
      ])
      .on("end", resolve)
      .on("error", reject)
      .save(outputPath);
  });
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

      const source = await inspectVideo(inputPath);
      const sourceFps = source.avgFps || source.fps || 30;
      const outputFps = Math.min(60, Math.max(23, sourceFps));
      const fpsLabel = outputFps.toFixed(outputFps % 1 === 0 ? 0 : 2);
      const canPreserveSource = isCompatibleSource(source);

      console.log(`🎞 SOURCE: ${source.width}x${source.height} @ ${sourceFps.toFixed(3)} fps | codec=${source.codec} | format=${source.format} | HDR=${source.hdr} | CFR=${sameFps(source.fps, source.avgFps)}`);

      if (canPreserveSource) {
        console.log("🟢 SOURCE-PRESERVE: compatible H.264 source detected — no video re-encode");

        await remuxSource(inputPath, outputPath);

        const statusText = lang === "kk"
          ? `⏳ **Видео дайындалып жатыр...**\n[██████████] 100%\n\n🟢 Түпнұсқа видео қайта кодталмады\n🎯 ${source.width}×${source.height} • ${fpsLabel} FPS • H.264`
          : `⏳ **Видео дайындалып жатыр...**\n[██████████] 100%\n\n🟢 Исходное видео не перекодировалось\n🎯 ${source.width}×${source.height} • ${fpsLabel} FPS • H.264`;
        await bot.api.editMessageText(chatId, job.data.statusMsgId, statusText, { parse_mode: "Markdown" }).catch(() => {});
      } else {
        console.log(`🎯 SMART ENCODE: 1080x1920 @ ${fpsLabel} fps | H.264 High | CRF 17 | maxrate 16M`);

        const videoFilters = source.hdr
          ? [
              "zscale=transfer=linear:npl=100",
              "format=gbrpf32le",
              "tonemap=hable:desat=0",
              "zscale=primaries=bt709:transfer=bt709:matrix=bt709",
              "format=yuv420p",
            ]
          : [];

        videoFilters.push(
          "scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos",
          "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black",
        );

        await new Promise((resolve, reject) => {
          ffmpeg(inputPath)
            .outputOptions([
              "-map 0:v:0",
              "-map 0:a:0?",
              `-vf ${videoFilters.join(",")}`,
              "-c:v libx264",
              "-preset slow",
              "-crf 17",
              "-crf_max 20",
              "-maxrate 16M",
              "-bufsize 32M",
              "-profile:v high",
              "-level 4.2",
              "-pix_fmt yuv420p",
              `-r ${fpsLabel}`,
              "-fps_mode cfr",
              "-g 120",
              "-keyint_min 60",
              "-sc_threshold 40",
              "-aq-mode 2",
              "-aq-strength 1.0",
              "-x264-params psy-rd=1.0,0.15:deblock=-1,-1:ref=4",
              "-c:a aac",
              "-b:a 192k",
              "-ar 48000",
              "-ac 2",
              "-movflags +faststart",
              "-map_metadata -1",
            ])
            .on("progress", async (progress) => {
              const percent = Math.min(100, Math.max(0, Math.round(progress.percent || 0)));
              if (Date.now() - lastEditTime > 3000) {
                lastEditTime = Date.now();
                const bar = renderProgressBar(percent);
                const statusText = lang === "kk"
                  ? `⏳ **Видео TikTok үшін оңтайландырылуда...**\n[${bar}] ${percent}%\n\n🎯 1080×1920 • ${fpsLabel} FPS • H.264`
                  : `⏳ **Оптимизация видео для TikTok...**\n[${bar}] ${percent}%\n\n🎯 1080×1920 • ${fpsLabel} FPS • H.264`;
                await bot.api.editMessageText(chatId, job.data.statusMsgId, statusText, { parse_mode: "Markdown" }).catch(() => {});
              }
            })
            .on("end", resolve)
            .on("error", reject)
            .save(outputPath);
        });
      }

      await markVideoDelivering(prisma, usageRecordId);

      await bot.api.sendDocument(chatId, new InputFile(outputPath, `HD_${fileName}`), {
        caption: lang === "kk"
          ? "🎉 **Видеоңыз TikTok үшін жоғары сапада оңтайландырылды!**\n\n📌 *TikTok-қа жүктегенде жоғары сапалы жүктеуді қосыңыз.*"
          : "🎉 **Ваше видео оптимизировано для TikTok в высоком качестве!**\n\n📌 *При загрузке в TikTok включите загрузку в высоком качестве.*",
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
