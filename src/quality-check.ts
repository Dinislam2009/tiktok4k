import type { Bot } from "grammy";
import type { PrismaClient } from "@prisma/client";
import ytDlp from "yt-dlp-exec";
import ffprobeStatic from "ffprobe-static";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);
const pendingQualityChecks = new Set<number>();

function isTikTokUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    return host === "tiktok.com" || host.endsWith(".tiktok.com");
  } catch {
    return false;
  }
}

function formatNumber(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatDuration(seconds: unknown): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function formatSize(bytes: unknown): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "—";
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} МБ`;
}

function formatBitrate(kbps: unknown): string {
  if (typeof kbps !== "number" || !Number.isFinite(kbps) || kbps <= 0) return "—";
  return `${(kbps / 1000).toFixed(2)} Мбит/с`;
}

function parseFps(value: unknown): number {
  if (typeof value !== "string" || !value) return 0;
  const [num, den] = value.split("/").map(Number);
  if (Number.isFinite(num) && Number.isFinite(den) && den > 0) return num / den;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseBitrate(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed / 1000 : 0;
}

function bestVideoFormat(info: any): any {
  const formats = Array.isArray(info?.formats) ? info.formats : [];
  const videos = formats.filter(
    (format: any) => Number(format?.height) > 0 && format?.vcodec && format.vcodec !== "none",
  );
  videos.sort((a: any, b: any) => {
    const score = (format: any) =>
      (Number(format.height) || 0) * 1_000_000 +
      (Number(format.width) || 0) * 1_000 +
      (Number(format.fps) || 0) * 100 +
      (Number(format.vbr || format.tbr) || 0);
    return score(b) - score(a);
  });
  return videos[0] || info;
}

async function downloadForInspection(url: string): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "tiktok4k-quality-"));
  const outputTemplate = path.join(dir, "video.%(ext)s");

  try {
    await ytDlp(url, {
      output: outputTemplate,
      format: "bestvideo*+bestaudio/best",
      mergeOutputFormat: "mp4",
      noPlaylist: true,
      noWarnings: true,
      noCheckCertificates: true,
      restrictFilenames: true,
    } as any);

    const files = await import("node:fs/promises").then((fs) => fs.readdir(dir));
    const mediaFile = files.find((name) => /\.(mp4|webm|mkv|mov)$/i.test(name));
    if (!mediaFile) throw new Error("Downloaded TikTok media file was not found");

    return { dir, file: path.join(dir, mediaFile) };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

async function probeActualFile(file: string) {
  const { stdout } = await execFileAsync(
    ffprobeStatic.path,
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_entries",
      "format=duration,size,bit_rate,format_name,format_long_name:stream=index,codec_type,codec_name,codec_long_name,profile,width,height,pix_fmt,r_frame_rate,avg_frame_rate,bit_rate,nb_frames,color_space,color_transfer,color_primaries,sample_rate,channels,channel_layout",
      file,
    ],
    { maxBuffer: 2 * 1024 * 1024 },
  );

  const parsed = JSON.parse(stdout);
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
  const video = streams.find((stream: any) => stream.codec_type === "video") || null;
  const audio = streams.find((stream: any) => stream.codec_type === "audio") || null;
  const format = parsed?.format || {};
  const fileStat = await stat(file);

  const width = Number(video?.width) || 0;
  const height = Number(video?.height) || 0;
  const fps = parseFps(video?.avg_frame_rate || video?.r_frame_rate);
  const duration = Number(format?.duration) || 0;
  const size = Number(fileStat.size) || Number(format?.size) || 0;
  const videoBitrate = parseBitrate(video?.bit_rate);
  const audioBitrate = parseBitrate(audio?.bit_rate);
  const totalBitrate = parseBitrate(format?.bit_rate);
  const effectiveVideoBitrate = videoBitrate || Math.max(0, totalBitrate - audioBitrate);
  const bpppf = width && height && fps && effectiveVideoBitrate
    ? (effectiveVideoBitrate * 1000) / (width * height * fps)
    : 0;

  return {
    width,
    height,
    fps,
    duration,
    size,
    videoBitrate: effectiveVideoBitrate,
    audioBitrate,
    bpppf,
    videoCodec: video?.codec_name || "—",
    videoCodecLong: video?.codec_long_name || "—",
    profile: video?.profile || "—",
    pixelFormat: video?.pix_fmt || "—",
    frameRateRaw: video?.avg_frame_rate || video?.r_frame_rate || "—",
    frameCount: Number(video?.nb_frames) || 0,
    colorSpace: video?.color_space || "—",
    colorTransfer: video?.color_transfer || "—",
    colorPrimaries: video?.color_primaries || "—",
    audioCodec: audio?.codec_name || "—",
    audioSampleRate: Number(audio?.sample_rate) || 0,
    audioChannels: Number(audio?.channels) || 0,
    audioLayout: audio?.channel_layout || "—",
    container: format?.format_name || "—",
    containerLong: format?.format_long_name || "—",
  };
}

function extractClaims(text: string) {
  const normalized = text.toLowerCase().replace(/,/g, ".");
  const claims4k = /\b(?:4k|2160p|uhd)\b/i.test(normalized);
  const claims8k = /\b(?:8k|4320p)\b/i.test(normalized);
  const fpsClaims = [...normalized.matchAll(/\b(24|25|30|50|60|90|120|144|240)\s*fps\b/gi)].map((m) => Number(m[1]));
  return { claims4k, claims8k, fpsClaims };
}

function claimStatus(actual: ReturnType<typeof extractClaims>, data: any, lang: "kk" | "ru") {
  const verticalResolution = Math.max(data.width, data.height);
  const is4k = verticalResolution >= 2160;
  const is8k = verticalResolution >= 4320;
  const claimedHighFps = actual.fpsClaims.length > 0 ? Math.max(...actual.fpsClaims) : 0;

  const lines: string[] = [];
  if (actual.claims8k) {
    lines.push(is8k ? "✅ 8K — подтверждено" : "❌ 8K — не подтверждено");
  }
  if (actual.claims4k) {
    lines.push(is4k ? "✅ 4K — подтверждено" : "❌ 4K — не подтверждено");
  }
  if (claimedHighFps) {
    lines.push(data.fps + 0.5 >= claimedHighFps
      ? `✅ ${claimedHighFps} FPS — подтверждено`
      : `❌ ${claimedHighFps} FPS — не подтверждено (фактически ${data.fps.toFixed(2)} FPS)`);
  }

  if (!lines.length) return "";
  if (lang === "kk") {
    return `\n🔍 **МӘЛІМДЕМЕНІ ТЕКСЕРУ**\n${lines.map((line) => line.replace("подтверждено", "расталды").replace("не подтверждено", "расталмады").replace("фактически", "нақты")).join("\n")}`;
  }
  return `\n🔍 **ПРОВЕРКА ЗАЯВЛЕНИЙ**\n${lines.join("\n")}`;
}

function qualityComment(data: any, lang: "kk" | "ru"): string {
  const { width, height, fps, videoBitrate, bpppf } = data;
  if (!width || !height) return lang === "kk" ? "💡 Нақты файлдан кадр өлшемін анықтау мүмкін болмады." : "💡 Не удалось определить размеры кадра из фактического файла.";
  if (!videoBitrate) return lang === "kk" ? "💡 Нақты файлда видео битрейті көрсетілмеді." : "💡 В фактическом файле видеобитрейт не указан.";

  const pixels = width * height;
  if (pixels >= 3840 * 2160 && videoBitrate >= 15_000) return lang === "kk" ? "💎 Өте жоғары сапа: нақты файлда жоғары ажыратымдылық пен жоғары битрейт бар." : "💎 Очень высокое качество: фактический файл имеет высокое разрешение и высокий битрейт.";
  if (pixels >= 1920 * 1080 && videoBitrate >= 6_000) return lang === "kk" ? "🟢 Жоғары сапа: нақты файл Full HD/одан жоғары және битрейті жеткілікті." : "🟢 Высокое качество: фактический файл Full HD/выше и с достаточным битрейтом.";
  if (pixels >= 1280 * 720 && videoBitrate >= 3_000) return lang === "kk" ? "🟡 Жақсы сапа: нақты файл күнделікті қарауға жеткілікті." : "🟡 Хорошее качество: фактический файл подходит для обычного просмотра.";
  if (bpppf > 0 && bpppf < 0.03) return lang === "kk" ? "🔴 Нақты файлдың бит/пиксель/кадр көрсеткіші төмен." : "🔴 У фактического файла низкий показатель бит/пиксель/кадр.";
  return lang === "kk" ? "🟡 Орташа сапа: нақты файлдың ажыратымдылығы немесе битрейті шектеулі." : "🟡 Среднее качество: разрешение или битрейт фактического файла ограничены.";
}

function buildReport(info: any, actual: any, lang: "kk" | "ru", url: string): string {
  const title = String(info?.title || info?.description || "TikTok видео").trim().replace(/\s+/g, " ").slice(0, 180);
  const username = info?.uploader || info?.channel || info?.uploader_id || "—";
  const handle = String(username).startsWith("@") ? String(username) : `@${username}`;
  const verified = info?.channel_is_verified ? " ✓" : "";
  const followers = info?.channel_follower_count;
  const views = formatNumber(info?.view_count);
  const likes = formatNumber(info?.like_count);
  const comments = formatNumber(info?.comment_count);
  const shares = formatNumber(info?.repost_count);
  const saves = formatNumber(info?.save_count);
  const claims = extractClaims(`${title} ${String(info?.description || "")}`);
  const claimText = claimStatus(claims, actual, lang);

  if (lang === "kk") {
    return `📊 **САПАНЫ ТЕКСЕРУ**\n\n🎬 ${title}\n👤 ${handle}${verified}\n\n📦 **Нақты TikTok файлы**\n📐 Ажыратымдылық: **${actual.width && actual.height ? `${actual.width}×${actual.height}` : "—"} @ ${actual.fps ? actual.fps.toFixed(2) : "—"} FPS**\n🎞 Видео кодегі: **${actual.videoCodec}**${actual.profile !== "—" ? ` · ${actual.profile}` : ""}\n📶 Видео битрейті: **${formatBitrate(actual.videoBitrate)}**\n🎧 Аудио: **${actual.audioCodec}${actual.audioBitrate ? ` · ${formatBitrate(actual.audioBitrate)}` : ""}**\n⏱ Ұзақтығы: **${formatDuration(actual.duration)}**\n💾 Файл өлшемі: **${formatSize(actual.size)}**\n🧮 Бит/пиксель/кадр: **${actual.bpppf ? actual.bpppf.toFixed(4) : "—"}**\n🎨 Pixel format: **${actual.pixelFormat}**\n🎞 Frame rate: **${actual.frameRateRaw}**\n${actual.frameCount ? `🔢 Кадр саны: **${formatNumber(actual.frameCount)}**\n` : ""}📦 Контейнер: **${actual.container}**\n\n👁 ${views} · ❤️ ${likes} · 💬 ${comments} · 🔁 ${shares} · 🔖 ${saves}\n${followers != null ? `👥 Автор оқырмандары: **${formatNumber(followers)}**\n` : ""}${claimText}\n\n${qualityComment(actual, lang)}\n\n🔗 ${url}`;
  }

  return `📊 **ПРОВЕРКА КАЧЕСТВА**\n\n🎬 ${title}\n👤 ${handle}${verified}\n\n📦 **Фактический TikTok-файл**\n📐 Разрешение: **${actual.width && actual.height ? `${actual.width}×${actual.height}` : "—"} @ ${actual.fps ? actual.fps.toFixed(2) : "—"} FPS**\n🎞 Видеокодек: **${actual.videoCodec}**${actual.profile !== "—" ? ` · ${actual.profile}` : ""}\n📶 Видеобитрейт: **${formatBitrate(actual.videoBitrate)}**\n🎧 Аудио: **${actual.audioCodec}${actual.audioBitrate ? ` · ${formatBitrate(actual.audioBitrate)}` : ""}**\n⏱ Длительность: **${formatDuration(actual.duration)}**\n💾 Размер файла: **${formatSize(actual.size)}**\n🧮 Бит/пиксель/кадр: **${actual.bpppf ? actual.bpppf.toFixed(4) : "—"}**\n🎨 Pixel format: **${actual.pixelFormat}**\n🎞 Frame rate: **${actual.frameRateRaw}**\n${actual.frameCount ? `🔢 Количество кадров: **${formatNumber(actual.frameCount)}**\n` : ""}📦 Контейнер: **${actual.container}**\n\n👁 ${views} · ❤️ ${likes} · 💬 ${comments} · 🔁 ${shares} · 🔖 ${saves}\n${followers != null ? `👥 Подписчики автора: **${formatNumber(followers)}**\n` : ""}${claimText}\n\n${qualityComment(actual, lang)}\n\n🔗 ${url}`;
}

export function registerQualityCheck(bot: Bot, prisma: PrismaClient) {
  bot.hears(["📊 Сапаны тексеру", "📊 Проверка качества"], async (ctx) => {
    const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
    if (!user) return;
    pendingQualityChecks.add(ctx.from.id);
    const lang = (user.language as "kk" | "ru") || "kk";
    await ctx.reply(
      lang === "kk"
        ? "📊 **САПАНЫ ТЕКСЕРУ**\n\nTikTok видеосының сілтемесін жіберіңіз.\n\n🎯 Бұл функцияға видео лимиті жұмсалмайды.\n♾️ Қолдану санына кредит шектеуі жоқ."
        : "📊 **ПРОВЕРКА КАЧЕСТВА**\n\nОтправьте ссылку на TikTok-видео.\n\n🎯 Лимит видео на эту функцию не тратится.\n♾️ Кредитного ограничения по количеству проверок нет.",
      { parse_mode: "Markdown" },
    );
  });

  bot.on("message:text", async (ctx, next) => {
    if (!pendingQualityChecks.has(ctx.from.id)) return next();
    const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
    if (!user) return next();
    const lang = (user.language as "kk" | "ru") || "kk";
    const url = ctx.message.text.trim();
    if (!isTikTokUrl(url)) {
      await ctx.reply(lang === "kk" ? "⚠️ TikTok сілтемесін толық жіберіңіз." : "⚠️ Отправьте полную ссылку на TikTok.");
      return;
    }

    pendingQualityChecks.delete(ctx.from.id);
    const loading = await ctx.reply(lang === "kk" ? "🔎 TikTok видеосы жүктеліп, нақты файл тексерілуде..." : "🔎 Скачиваю TikTok-видео и проверяю фактический файл...");
    let dir = "";

    try {
      const metadataRaw = await ytDlp(url, {
        dumpSingleJson: true,
        noWarnings: true,
        noPlaylist: true,
        skipDownload: true,
        noCheckCertificates: true,
      } as any);
      const info = typeof metadataRaw === "string" ? JSON.parse(metadataRaw) : metadataRaw;

      const downloaded = await downloadForInspection(url);
      dir = downloaded.dir;
      const actual = await probeActualFile(downloaded.file);

      await ctx.api.editMessageText(
        ctx.chat.id,
        loading.message_id,
        buildReport(info, actual, lang, url),
        { parse_mode: "Markdown" },
      );
    } catch (error: any) {
      console.error("TikTok quality check error:", error?.stderr || error?.message || error);
      await ctx.api.editMessageText(
        ctx.chat.id,
        loading.message_id,
        lang === "kk"
          ? "❌ TikTok видеосын нақты файл ретінде тексеру мүмкін болмады. Сілтеменің ашық видеоға тиесілі екенін тексеріп, қайта көріңіз."
          : "❌ Не удалось скачать и проверить фактический файл TikTok. Проверьте, что это открытое видео, и попробуйте снова.",
      );
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}
