import { InlineKeyboard } from "grammy";
import type { Bot } from "grammy";
import { PrismaClient, PurchaseStatus } from "@prisma/client";
import { adminMenu, adminCreditKeyboard, adminUserKeyboard, adminBannedUserKeyboard } from "./keyboards.js";
import { getCreditBalance, grantPurchasedCredits } from "./credits.js";

const ADMIN_TELEGRAM_IDS = new Set((process.env.ADMIN_TELEGRAM_IDS || "").split(",").map(v => v.trim()).filter(Boolean));
const pending = new Map<number, { text?: string; audience?: "all" | "kk" | "ru"; step: "text" | "audience" | "confirm" }>();
const userActions = new Map<number, { action: "search" | "credit" | "history" | "remove" | "ban" | "unban"; userId?: string }>();

export function isAdmin(telegramId?: number | bigint) {
  return telegramId !== undefined && ADMIN_TELEGRAM_IDS.has(String(telegramId));
}

function purchaseKeyboard() {
  return new InlineKeyboard()
    .text("⏳ Күтілуде", "admin:purchases:pending")
    .text("✅ Төленген", "admin:purchases:paid")
    .row()
    .text("❌ Болдырылмаған", "admin:purchases:cancelled")
    .text("📊 Қорытынды", "admin:purchases:summary")
    .row()
    .text("⬅️ Артқа", "admin:back");
}

function broadcastAudienceKeyboard() {
  return new InlineKeyboard()
    .text("👥 Барлығы", "admin:broadcast:audience:all")
    .row()
    .text("🇰🇿 Қазақша", "admin:broadcast:audience:kk")
    .text("🇷🇺 Русский", "admin:broadcast:audience:ru")
    .row()
    .text("❌ Болдырмау", "admin:broadcast:cancel");
}

function broadcastConfirmKeyboard() {
  return new InlineKeyboard()
    .text("🚀 Жіберу", "admin:broadcast:confirm")
    .text("✏️ Өзгерту", "admin:broadcast:edit")
    .row()
    .text("❌ Болдырмау", "admin:broadcast:cancel");
}

function purchaseStatusLabel(status: PurchaseStatus) {
  if (status === PurchaseStatus.PAID) return "Төленген";
  if (status === PurchaseStatus.CANCELLED) return "Болдырылмаған";
  return "Күтілуде";
}

function packageLabel(packageName: string) {
  if (packageName === "STARTER") return "Бастапқы пакет";
  if (packageName === "STANDARD") return "Стандартты пакет";
  if (packageName === "PRO") return "Кәсіби пакет";
  return packageName;
}

async function purchaseList(ctx: any, prisma: PrismaClient, status: PurchaseStatus) {
  const rows = await prisma.purchase.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: {
      id: true, userId: true, package: true, videos: true, priceKzt: true, status: true, paidAt: true, createdAt: true,
      user: { select: { telegramId: true, username: true } },
      creditLot: { select: { id: true, quantity: true, remaining: true } },
    },
  });

  if (!rows.length) return ctx.reply(`📦 ${purchaseStatusLabel(status)}\n\nЖазба жоқ.`, { reply_markup: purchaseKeyboard() });

  const text = rows.map((p, i) =>
    `${i + 1}. ${purchaseStatusLabel(p.status)} | ${packageLabel(p.package)}\n` +
    `👤 ${p.user.username ? "@" + p.user.username : p.user.telegramId}\n` +
    `🎬 ${p.videos} видео | 💰 ${p.priceKzt} ₸\n` +
    `📅 ${p.createdAt.toISOString()}\n` +
    `💳 Лимит: ${p.creditLot ? `${p.creditLot.remaining}/${p.creditLot.quantity}` : "—"}`
  ).join("\n\n");

  return ctx.reply(`📦 *САТЫП АЛУЛАР — ${purchaseStatusLabel(status)}*\n\n${text}`, {
    parse_mode: "Markdown",
    reply_markup: purchaseKeyboard(),
  });
}

function userLookupKeyboard(user: any) {
  return user.isBanned ? adminBannedUserKeyboard() : adminUserKeyboard();
}

async function resolveUser(prisma: PrismaClient, input: string) {
  const value = input.trim().replace(/^@/, "");
  if (!value) return null;
  if (/^\d+$/.test(value)) return prisma.user.findUnique({ where: { telegramId: BigInt(value) } });
  return prisma.user.findFirst({ where: { username: value } });
}

async function showUser(ctx: any, prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, telegramId: true, username: true, language: true, isBanned: true, banReason: true, bannedAt: true, createdAt: true },
  });
  if (!user) return ctx.reply("❌ Қолданушы табылмады.");

  const balance = await getCreditBalance(prisma, user.id);
  const videos = await prisma.usageRecord.count({ where: { userId: user.id, status: "COMPLETED" } });
  const purchases = await prisma.purchase.count({ where: { userId: user.id, status: PurchaseStatus.PAID } });

  const language = user.language === "ru" ? "Русский" : "Қазақша";
  const text =
    `👤 *ҚОЛДАНУШЫ*\n\n` +
    `🆔 Telegram ID: \`${user.telegramId}\`\n` +
    `${user.username ? `📛 Username: @${user.username}\n` : ""}` +
    `🌐 Тілі: ${language}\n\n` +
    `🎁 Тегін видео: ${balance.free}\n` +
    `👥 Дос шақыру бонусы: ${balance.referral}\n` +
    `💳 Сатып алынған видео: ${balance.purchased}\n` +
    `📊 Барлығы: ${balance.total}\n\n` +
    `🎬 Аяқталған видеолар: ${videos}\n` +
    `📦 Төленген сатып алулар: ${purchases}\n` +
    `🚫 Бұғатталған: ${user.isBanned ? "Иә" : "Жоқ"}` +
    `${user.banReason ? `\nСебебі: ${user.banReason}` : ""}`;

  await ctx.reply(text, { parse_mode: "Markdown", reply_markup: userLookupKeyboard(user) });
}

export function registerAdminPanel(bot: Bot, prisma: PrismaClient) {
  bot.command("admin", async ctx => {
    if (!isAdmin(ctx.from?.id)) return;
    await ctx.reply("🛠 *TIKTOK4K БАСҚАРУ ПАНЕЛІ*", { parse_mode: "Markdown", reply_markup: adminMenu() });
  });

  bot.callbackQuery("admin:users", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Қол жеткізуге рұқсат жоқ" });
    userActions.set(ctx.from!.id, { action: "search" });
    await ctx.answerCallbackQuery();
    await ctx.reply("🔎 *ҚОЛДАНУШЫ ІЗДЕУ*\n\nTelegram ID немесе @username жіберіңіз:", { parse_mode: "Markdown" });
  });

  bot.callbackQuery("admin:credits", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Қол жеткізуге рұқсат жоқ" });
    userActions.set(ctx.from!.id, { action: "credit" });
    await ctx.answerCallbackQuery();
    await ctx.reply("🎟 *ВИДЕО ЛИМИТІН БАСҚАРУ*\n\nЛимит қосылатын Telegram ID немесе @username жіберіңіз:", { parse_mode: "Markdown" });
  });

  bot.callbackQuery("admin:videos", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Қол жеткізуге рұқсат жоқ" });
    const [completed, failed, running] = await Promise.all([
      prisma.usageRecord.count({ where: { status: "COMPLETED" } }),
      prisma.usageRecord.count({ where: { status: "FAILED" } }),
      prisma.usageRecord.count({ where: { status: { in: ["RUNNING", "PROCESSING", "DELIVERING"] } } }),
    ]);
    await ctx.answerCallbackQuery();
    await ctx.reply(`🎬 *ВИДЕО СТАТИСТИКАСЫ*\n\n✅ Аяқталған: ${completed}\n❌ Қате болған: ${failed}\n⏳ Өңделіп жатқан: ${running}`, { parse_mode: "Markdown", reply_markup: adminMenu() });
  });

  bot.callbackQuery("admin:referrals", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Қол жеткізуге рұқсат жоқ" });
    const [total, granted] = await Promise.all([
      prisma.referral.count(),
      prisma.referral.count({ where: { bonusGranted: true } }),
    ]);
    await ctx.answerCallbackQuery();
    await ctx.reply(`👥 *ДОС ШАҚЫРУ СТАТИСТИКАСЫ*\n\nБарлығы: ${total}\n🎁 Бонус берілгені: ${granted}`, { parse_mode: "Markdown", reply_markup: adminMenu() });
  });

  bot.callbackQuery("admin:user:search", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Қол жеткізуге рұқсат жоқ" });
    userActions.set(ctx.from!.id, { action: "search" });
    await ctx.answerCallbackQuery();
    await ctx.reply("🔎 Telegram ID немесе @username жіберіңіз:");
  });

  bot.callbackQuery("admin:user:history", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Қол жеткізуге рұқсат жоқ" });
    const state = userActions.get(ctx.from!.id);
    if (!state?.userId) return ctx.answerCallbackQuery({ text: "Алдымен қолданушыны таңдаңыз." });
    const rows = await prisma.usageRecord.findMany({
      where: { userId: state.userId }, orderBy: { createdAt: "desc" }, take: 15,
      select: { id: true, status: true, createdAt: true, completedAt: true, creditLotId: true },
    });
    const text = rows.length
      ? `🎬 *ВИДЕО ТАРИХЫ*\n\n${rows.map((r, i) => `${i + 1}. ${r.status}\n${r.createdAt.toISOString()}${r.completedAt ? ` → ${r.completedAt.toISOString()}` : ""}\nЛимит бөлігі: ${r.creditLotId || "—"}`).join("\n\n")}`
      : "📭 Видео тарихы бос.";
    await ctx.answerCallbackQuery();
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: adminUserKeyboard() });
  });

  for (const amount of [5, 10, 15] as const) {
    bot.callbackQuery(`admin:grant:${amount}`, async ctx => {
      if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Қол жеткізуге рұқсат жоқ" });
      const state = userActions.get(ctx.from!.id);
      if (!state?.userId) return ctx.answerCallbackQuery({ text: "Алдымен қолданушыны таңдаңыз." });
      const user = await prisma.user.findUnique({ where: { id: state.userId } });
      if (!user) return ctx.answerCallbackQuery({ text: "Қолданушы табылмады." });
      const result = await grantPurchasedCredits(prisma, user.id, amount);
      await ctx.answerCallbackQuery({ text: `+${amount} видео лимиті қосылды` });
      await ctx.reply(`✅ ${amount} видео қосылды.\n👤 ${user.telegramId}\n💳 Сатып алу: ${result.purchase.id}`);
    });
  }

  bot.callbackQuery("admin:user:remove", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Қол жеткізуге рұқсат жоқ" });
    const state = userActions.get(ctx.from!.id);
    if (!state?.userId) return ctx.answerCallbackQuery({ text: "Алдымен қолданушыны таңдаңыз." });
    const lot = await prisma.creditLot.findFirst({ where: { userId: state.userId, remaining: { gt: 0 } }, orderBy: { createdAt: "asc" } });
    if (!lot) return ctx.answerCallbackQuery({ text: "Видео лимиті жоқ." });
    await prisma.creditLot.update({ where: { id: lot.id }, data: { remaining: { decrement: 1 } } });
    await ctx.answerCallbackQuery({ text: "-1 видео лимиті алынды" });
    await ctx.reply("✅ 1 видео лимиті алынды.");
  });

  bot.callbackQuery("admin:user:ban", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Қол жеткізуге рұқсат жоқ" });
    const state = userActions.get(ctx.from!.id);
    if (!state?.userId) return ctx.answerCallbackQuery({ text: "Алдымен қолданушыны іздеңіз." });
    userActions.set(ctx.from!.id, { action: "ban", userId: state.userId });
    await ctx.answerCallbackQuery();
    await ctx.reply("🚫 Бұғаттау себебін жазыңыз (немесе `-`):", { parse_mode: "Markdown" });
  });

  bot.callbackQuery("admin:user:unban", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Қолданушыны таңдаңыз." });
    const state = userActions.get(ctx.from!.id);
    if (!state?.userId) return ctx.answerCallbackQuery({ text: "Қолданушы таңдалмаған." });
    await prisma.user.update({ where: { id: state.userId }, data: { isBanned: false, banReason: null, bannedAt: null } });
    userActions.set(ctx.from!.id, { action: "search", userId: state.userId });
    await ctx.answerCallbackQuery({ text: "Қолданушы бұғаттан шығарылды" });
    await showUser(ctx, prisma, state.userId);
  });

  bot.callbackQuery("admin:broadcast", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Қол жеткізуге рұқсат жоқ" });
    pending.set(ctx.from!.id, { step: "text" });
    await ctx.answerCallbackQuery();
    await ctx.reply("📢 *ЖАППАЙ ХАБАРЛАМА*\n\nЖіберілетін мәтінді енгізіңіз:", { parse_mode: "Markdown" });
  });

  bot.callbackQuery("admin:broadcast:audience:all", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Қол жеткізуге рұқсат жоқ" });
    await selectBroadcastAudience(ctx, prisma, "all");
  });

  bot.callbackQuery("admin:broadcast:audience:kk", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Қол жеткізуге рұқсат жоқ" });
    await selectBroadcastAudience(ctx, prisma, "kk");
  });

  bot.callbackQuery("admin:broadcast:audience:ru", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Қол жеткізуге рұқсат жоқ" });
    await selectBroadcastAudience(ctx, prisma, "ru");
  });

  bot.callbackQuery("admin:broadcast:edit", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Қол жеткізуге рұқсат жоқ" });
    pending.set(ctx.from!.id, { step: "text" });
    await ctx.answerCallbackQuery();
    await ctx.reply("✏️ Жаңа мәтінді енгізіңіз:");
  });

  bot.callbackQuery("admin:broadcast:cancel", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Қол жеткізуге рұқсат жоқ" });
    pending.delete(ctx.from!.id);
    await ctx.answerCallbackQuery({ text: "Жаппай хабарлама тоқтатылды" });
    await ctx.reply("❌ Жаппай хабарлама тоқтатылды.");
  });

  bot.callbackQuery("admin:broadcast:confirm", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Қол жеткізуге рұқсат жоқ" });
    const state = pending.get(ctx.from!.id);
    if (!state?.text || !state.audience) return ctx.answerCallbackQuery({ text: "Белсенді жаппай хабарлама жоқ." });

    pending.delete(ctx.from.id);
    await ctx.answerCallbackQuery({ text: "Жіберу басталды" });

    const users = await prisma.user.findMany({
      where: state.audience === "all" ? {} : { language: state.audience },
      select: { telegramId: true },
    });

    let sent = 0;
    let failed = 0;
    for (const user of users) {
      try {
        await ctx.api.sendMessage(user.telegramId.toString(), state.text);
        sent++;
      } catch {
        failed++;
      }
      await new Promise(r => setTimeout(r, 60));
    }

    await ctx.reply(`📊 *ЖАППАЙ ХАБАРЛАМА НӘТИЖЕСІ*\n\n👥 Барлығы: ${users.length}\n✅ Жіберілді: ${sent}\n❌ Жіберілмеді: ${failed}`, { parse_mode: "Markdown" });
  });

  bot.on("message:text", async ctx => {
    if (!isAdmin(ctx.from?.id)) return;

    const state = userActions.get(ctx.from.id);
    if (state) {
      if (["search", "credit"].includes(state.action)) {
        const user = await resolveUser(prisma, ctx.message.text);
        if (!user) return ctx.reply("❌ Қолданушы табылмады. Telegram ID немесе @username қайта жіберіңіз.");
        userActions.set(ctx.from.id, { action: state.action, userId: user.id });
        if (state.action === "credit") return ctx.reply("🎟 Қанша видео лимитін қосамыз?", { reply_markup: adminCreditKeyboard() });
        return showUser(ctx, prisma, user.id);
      }
      if (state.action === "ban" && state.userId) {
        const reason = ctx.message.text.trim() === "-" ? null : ctx.message.text.trim();
        await prisma.user.update({ where: { id: state.userId }, data: { isBanned: true, banReason: reason, bannedAt: new Date() } });
        userActions.set(ctx.from.id, { action: "search", userId: state.userId });
        await ctx.reply("🚫 Қолданушы бұғатталды.");
        return showUser(ctx, prisma, state.userId);
      }
    }

    const broadcastState = pending.get(ctx.from.id);
    if (!broadcastState) return;

    if (broadcastState.step === "text") {
      broadcastState.text = ctx.message.text;
      broadcastState.step = "audience";
      return ctx.reply("👥 *АУДИТОРИЯНЫ ТАҢДАҢЫЗ*", {
        parse_mode: "Markdown",
        reply_markup: broadcastAudienceKeyboard(),
      });
    }
  });

  bot.callbackQuery("admin:purchases", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Қол жеткізуге рұқсат жоқ" });
    const [pendingCount, paidCount, cancelledCount, revenue] = await Promise.all([
      prisma.purchase.count({ where: { status: "PENDING" } }),
      prisma.purchase.count({ where: { status: "PAID" } }),
      prisma.purchase.count({ where: { status: "CANCELLED" } }),
      prisma.purchase.aggregate({ where: { status: "PAID" }, _sum: { priceKzt: true, videos: true } }),
    ]);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `📦 *САТЫП АЛУЛАР*\n\n⏳ Күтілуде: ${pendingCount}\n✅ Төленген: ${paidCount}\n❌ Болдырылмаған: ${cancelledCount}\n\n💰 Түсім: ${revenue._sum.priceKzt || 0} ₸\n🎬 Төленген видеолар: ${revenue._sum.videos || 0}`,
      { parse_mode: "Markdown", reply_markup: purchaseKeyboard() }
    );
  });

  for (const [key, status] of [["pending", PurchaseStatus.PENDING], ["paid", PurchaseStatus.PAID], ["cancelled", PurchaseStatus.CANCELLED]] as const) {
    bot.callbackQuery(`admin:purchases:${key}`, async ctx => {
      if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Қол жеткізуге рұқсат жоқ" });
      await ctx.answerCallbackQuery();
      await purchaseList(ctx, prisma, status);
    });
  }

  bot.callbackQuery("admin:purchases:summary", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Қол жеткізуге рұқсат жоқ" });
    const grouped = await Promise.all(["STARTER", "STANDARD", "PRO"].map(async packageName => {
      const result = await prisma.purchase.aggregate({
        where: { status: PurchaseStatus.PAID, package: packageName as any },
        _count: { _all: true },
        _sum: { priceKzt: true, videos: true },
      });
      return `${packageLabel(packageName)}: ${result._count._all} сатып алу | ${result._sum.videos || 0} видео | ${result._sum.priceKzt || 0} ₸`;
    }));
    await ctx.answerCallbackQuery();
    await ctx.reply(`📊 *САТЫП АЛУЛАР ҚОРЫТЫНДЫСЫ*\n\n${grouped.join("\n")}`, { parse_mode: "Markdown", reply_markup: purchaseKeyboard() });
  });

  bot.callbackQuery("admin:stats", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Қол жеткізуге рұқсат жоқ" });
    const [users, purchases, videos] = await Promise.all([
      prisma.user.count(),
      prisma.purchase.count({ where: { status: "PAID" } }),
      prisma.usageRecord.count({ where: { status: "COMPLETED" } }),
    ]);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`📊 *ЖАЛПЫ СТАТИСТИКА*\n\n👥 Қолданушылар: ${users}\n📦 Төленген сатып алулар: ${purchases}\n🎬 Аяқталған видеолар: ${videos}`, { parse_mode: "Markdown", reply_markup: adminMenu() });
  });

  bot.callbackQuery("admin:back", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Қол жеткізуге рұқсат жоқ" });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("🛠 *TIKTOK4K БАСҚАРУ ПАНЕЛІ*", { parse_mode: "Markdown", reply_markup: adminMenu() });
  });

  bot.callbackQuery("admin:close", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Қол жеткізуге рұқсат жоқ" });
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => undefined);
  });
}

async function selectBroadcastAudience(ctx: any, prisma: PrismaClient, audience: "all" | "kk" | "ru") {
  const state = pending.get(ctx.from.id);
  if (!state?.text) return ctx.answerCallbackQuery({ text: "Алдымен хабарлама мәтінін енгізіңіз." });

  state.audience = audience;
  state.step = "confirm";

  const count = audience === "all"
    ? await prisma.user.count()
    : await prisma.user.count({ where: { language: audience } });

  const audienceLabel = audience === "all" ? "Барлығы" : audience === "kk" ? "Қазақша" : "Русский";

  await ctx.answerCallbackQuery();
  await ctx.reply(
    `👀 *АЛДЫН АЛА КӨРІНІС*\n\n${state.text}\n\n👥 Аудитория: ${audienceLabel}\n📊 Қолданушылар саны: ${count}`,
    { parse_mode: "Markdown", reply_markup: broadcastConfirmKeyboard() }
  );
}
