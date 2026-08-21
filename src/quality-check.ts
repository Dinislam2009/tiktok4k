import type { Bot } from "grammy";
import type { PrismaClient } from "@prisma/client";
import ytDlp from "yt-dlp-exec";

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

function bestVideoFormat(info: any): any {
  const formats = Array.isArray(info?.formats) ? info.formats : [];
  const videos = formats.filter((format: any) => Number(format?.height) > 0 && format?.vcodec && format.vcodec !== "none");
  videos.sort((a: any, b: any) => {
    const score = (format: any) => (Number(format.height) || 0) * 1_000_000 + (Number(format.width) || 0) * 1_000 + (Number(format.fps) || 0) * 100 + (Number(format.vbr || format.tbr) || 0);
    return score(b) - score(a);
  });
  return videos[0] || info;
}

function getMediaData(info: any) {
  const format = bestVideoFormat(info);
  const width = Number(format?.width || info?.width) || 0;
  const height = Number(format?.height || info?.height) || 0;
  const fps = Number(format?.fps || info?.fps) || 0;
  const duration = Number(info?.duration) || 0;
  const size = Number(format?.filesize || format?.filesize_approx || info?.filesize || info?.filesize_approx) || 0;
  let videoBitrate = Number(format?.vbr || info?.vbr) || 0;
  if (!videoBitrate) {
    const totalBitrate = Number(format?.tbr || info?.tbr) || 0;
    const audioBitrate = Number(format?.abr || info?.abr) || 0;
    videoBitrate = Math.max(0, totalBitrate - audioBitrate);
  }
  if (!videoBitrate && size && duration) videoBitrate = (size * 8) / duration / 1000;
  const bpppf = width && height && fps && videoBitrate ? (videoBitrate * 1000) / (width * height * fps) : 0;
  return { format, width, height, fps, duration, size, videoBitrate, bpppf };
}

function qualityComment(data: ReturnType<typeof getMediaData>, lang: "kk" | "ru"): string {
  const { width, height, fps, videoBitrate, bpppf } = data;
  if (!width || !height) return lang === "kk" ? "💡 TikTok бұл сілтемеден нақты кадр өлшемін бермеді." : "💡 TikTok не вернул точные размеры кадра для этой ссылки.";
  const pixels = width * height;
  if (!videoBitrate) return lang === "kk" ? "💡 Битрейт дерегі ашық берілмеді, сондықтан сапаны толық бағалау мүмкін емес." : "💡 Битрейт не указан, поэтому полностью оценить качество невозможно.";
  if (pixels >= 3840 * 2160 && videoBitrate >= 15_000) return lang === "kk" ? "💎 Өте жоғары сапа: жоғары ажыратымдылық пен битрейт жақсы деңгейде." : "💎 Очень высокое качество: высокое разрешение и хороший битрейт.";
  if (pixels >= 1920 * 1080 && videoBitrate >= 6_000) return lang === "kk" ? "🟢 Жоғары сапа: Full HD/жоғары деңгей және жеткілікті битрейт." : "🟢 Высокое качество: Full HD/выше и достаточный битрейт.";
  if (pixels >= 1280 * 720 && videoBitrate >= 3_000) return lang === "kk" ? "🟡 Жақсы сапа: күнделікті қарауға жеткілікті, бірақ қайта кодтау байқалуы мүмкін." : "🟡 Хорошее качество: для просмотра достаточно, но повторное сжатие может быть заметным.";
  if (bpppf > 0 && bpppf < 0.03) return lang === "kk" ? "🔴 Битрейт кадрға шаққанда төмен — үлкен экранда мылжың/бұлыңғыр көрінуі мүмкін." : "🔴 Битрейт на кадр низкий — на большом экране изображение может выглядеть мыльным.";
  return lang === "kk" ? "🟡 Орташа сапа: ажыратымдылық немесе битрейт жоғары сапалы қайта өңдеуге шектеу болуы мүмкін." : "🟡 Среднее качество: разрешение или битрейт могут ограничивать качество после повторного сжатия.";
}

function buildReport(info: any, lang: "kk" | "ru", url: string): string {
  const data = getMediaData(info);
  const title = String(info?.title || info?.description || "TikTok видео").trim().replace(/\s+/g, " ").slice(0, 180);
  const username = info?.uploader || info?.channel || info?.uploader_id || "—";
  const handle = String(username).startsWith("@") ? String(username) : `@${username}`;
  const verified = info?.channel_is_verified ? " ✓" : "";
  const resolution = data.width && data.height ? `${data.width}×${data.height}` : "—";
  const fps = data.fps ? `${data.fps}` : "—";
  const videoCodec = data.format?.vcodec || info?.vcodec || "—";
  const audioCodec = data.format?.acodec || info?.acodec || "—";
  const audioBitrate = Number(data.format?.abr || info?.abr) || 0;
  const followers = info?.channel_follower_count;
  const views = formatNumber(info?.view_count);
  const likes = formatNumber(info?.like_count);
  const comments = formatNumber(info?.comment_count);
  const shares = formatNumber(info?.repost_count);
  const saves = formatNumber(info?.save_count);
  const bpppf = data.bpppf ? data.bpppf.toFixed(4) : "—";
  const source = info?.webpage_url || info?.original_url || url;

  if (lang === "kk") {
    return `📊 **САПАНЫ ТЕКСЕРУ**\n\n🎬 ${title}\n👤 ${handle}${verified}\n\n📐 Ажыратымдылық: **${resolution} @ ${fps} FPS**\n🎞 Видео кодегі: **${videoCodec}**\n📶 Видео битрейті: **${formatBitrate(data.videoBitrate)}**\n🎧 Аудио: **${audioCodec}${audioBitrate ? ` · ${formatBitrate(audioBitrate)}` : ""}**\n⏱ Ұзақтығы: **${formatDuration(data.duration)}**\n💾 Өлшемі: **${formatSize(data.size)}**\n🧮 Бит/пиксель/кадр: **${bpppf}**\n\n👁 ${views} · ❤️ ${likes} · 💬 ${comments} · 🔁 ${shares} · 🔖 ${saves}\n${followers != null ? `👥 Автор оқырмандары: **${formatNumber(followers)}**\n` : ""}\n${qualityComment(data, lang)}\n\n🔗 ${source}`;
  }

  return `📊 **ПРОВЕРКА КАЧЕСТВА**\n\n🎬 ${title}\n👤 ${handle}${verified}\n\n📐 Разрешение: **${resolution} @ ${fps} FPS**\n🎞 Видеокодек: **${videoCodec}**\n📶 Видеобитрейт: **${formatBitrate(data.videoBitrate)}**\n🎧 Аудио: **${audioCodec}${audioBitrate ? ` · ${formatBitrate(audioBitrate)}` : ""}**\n⏱ Длительность: **${formatDuration(data.duration)}**\n💾 Размер: **${formatSize(data.size)}**\n🧮 Бит/пиксель/кадр: **${bpppf}**\n\n👁 ${views} · ❤️ ${likes} · 💬 ${comments} · 🔁 ${shares} · 🔖 ${saves}\n${followers != null ? `👥 Подписчики автора: **${formatNumber(followers)}**\n` : ""}\n${qualityComment(data, lang)}\n\n🔗 ${source}`;
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
    const loading = await ctx.reply(lang === "kk" ? "🔎 TikTok деректері тексерілуде..." : "🔎 Проверяю данные TikTok...");
    try {
      const raw = await ytDlp(url, {
        dumpSingleJson: true,
        noWarnings: true,
        noPlaylist: true,
        skipDownload: true,
        noCheckCertificates: true,
      } as any);
      const info = typeof raw === "string" ? JSON.parse(raw) : raw;
      await ctx.api.editMessageText(ctx.chat.id, loading.message_id, buildReport(info, lang, url), { parse_mode: "Markdown" });
    } catch (error: any) {
      console.error("TikTok quality check error:", error?.stderr || error?.message || error);
      await ctx.api.editMessageText(
        ctx.chat.id,
        loading.message_id,
        lang === "kk"
          ? "❌ Бұл TikTok сілтемесінен деректерді алу мүмкін болмады. Сілтеменің ашық видеоға тиесілі екенін тексеріп, қайта көріңіз."
          : "❌ Не удалось получить данные по этой ссылке TikTok. Проверьте, что это открытое видео, и попробуйте снова.",
      );
    }
  });
}
