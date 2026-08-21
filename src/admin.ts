import { InlineKeyboard } from "grammy";
import type { Bot } from "grammy";
import { PrismaClient, PurchaseStatus } from "@prisma/client";
import { adminMenu, adminCreditKeyboard, adminUserKeyboard, adminBannedUserKeyboard } from "./keyboards.js";
import { getCreditBalance, grantPurchasedCredits } from "./credits.js";

const ADMIN_TELEGRAM_IDS = new Set((process.env.ADMIN_TELEGRAM_IDS || "").split(",").map(v => v.trim()).filter(Boolean));
const pending = new Map<number, { text?: string; audience?: "all" | "kk" | "ru"; step: "text" | "audience" | "confirm" }>();
const userActions = new Map<number, { action: "search" | "credit" | "history" | "remove" | "ban" | "unban"; userId?: string }>();

export function isAdmin(telegramId?: number | bigint) { return telegramId !== undefined && ADMIN_TELEGRAM_IDS.has(String(telegramId)); }

function purchaseKeyboard() {
  return new InlineKeyboard().text("⏳ Pending", "admin:purchases:pending").text("✅ Paid", "admin:purchases:paid").row().text("❌ Cancelled", "admin:purchases:cancelled").text("📊 Summary", "admin:purchases:summary").row().text("⬅️ Admin", "admin:back");
}

async function purchaseList(ctx: any, prisma: PrismaClient, status: PurchaseStatus) {
  const rows = await prisma.purchase.findMany({ where: { status }, orderBy: { createdAt: "desc" }, take: 15, select: { id: true, userId: true, package: true, videos: true, priceKzt: true, status: true, paidAt: true, createdAt: true, user: { select: { telegramId: true, username: true } }, creditLot: { select: { id: true, quantity: true, remaining: true } } } });
  if (!rows.length) return ctx.reply(`📦 ${status}\n\nЖазба жоқ.`, { reply_markup: purchaseKeyboard() });
  const text = rows.map((p, i) => `${i + 1}. ${p.status} | ${p.package}\n👤 ${p.user.username ? "@" + p.user.username : p.user.telegramId}\n🎬 ${p.videos} | 💰 ${p.priceKzt} ₸\n📅 ${p.createdAt.toISOString()}\n💳 Lot: ${p.creditLot ? `${p.creditLot.remaining}/${p.creditLot.quantity}` : "—"}`).join("\n\n");
  return ctx.reply(`📦 *PURCHASES — ${status}*\n\n${text}`, { parse_mode: "Markdown", reply_markup: purchaseKeyboard() });
}

function userLookupKeyboard(user: any) {
  const keyboard = user.isBanned ? adminBannedUserKeyboard() : adminUserKeyboard();
  return keyboard;
}

async function resolveUser(prisma: PrismaClient, input: string) {
  const value = input.trim().replace(/^@/, "");
  if (!value) return null;
  if (/^\d+$/.test(value)) return prisma.user.findUnique({ where: { telegramId: BigInt(value) } });
  return prisma.user.findFirst({ where: { username: value } });
}

async function showUser(ctx: any, prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, telegramId: true, username: true, language: true, isBanned: true, banReason: true, bannedAt: true, createdAt: true } });
  if (!user) return ctx.reply("❌ Қолданушы табылмады.");
  const balance = await getCreditBalance(prisma, user.id);
  const videos = await prisma.usageRecord.count({ where: { userId: user.id, status: "COMPLETED" } });
  const purchases = await prisma.purchase.count({ where: { userId: user.id, status: PurchaseStatus.PAID } });
  const text = `👤 *USER*\n\n🆔 Telegram ID: \`${user.telegramId}\`\n${user.username ? `📛 Username: @${user.username}\n` : ""}🌐 Language: ${user.language}\n\n🎟 Free: ${balance.free}\n🎁 Referral: ${balance.referral}\n💳 Purchased: ${balance.purchased}\n📊 Total: ${balance.total}\n\n🎬 Completed videos: ${videos}\n📦 Paid purchases: ${purchases}\n🚫 Banned: ${user.isBanned ? "YES" : "NO"}${user.banReason ? `\nReason: ${user.banReason}` : ""}`;
  await ctx.reply(text, { parse_mode: "Markdown", reply_markup: userLookupKeyboard(user) });
}

export function registerAdminPanel(bot: Bot, prisma: PrismaClient) {
  bot.command("admin", async ctx => { if (!isAdmin(ctx.from?.id)) return; await ctx.reply("🛠 *TIKTOK4K ADMIN PANEL*", { parse_mode: "Markdown", reply_markup: adminMenu() }); });

  bot.callbackQuery("admin:users", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    userActions.set(ctx.from!.id, { action: "search" }); await ctx.answerCallbackQuery();
    await ctx.reply("🔎 *USER SEARCH*\n\nTelegram ID немесе @username жіберіңіз:", { parse_mode: "Markdown" });
  });

  bot.callbackQuery("admin:credits", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    userActions.set(ctx.from!.id, { action: "credit" }); await ctx.answerCallbackQuery();
    await ctx.reply("🎟 *CREDIT MANAGEMENT*\n\nCredit қосылатын Telegram ID немесе @username жіберіңіз:", { parse_mode: "Markdown" });
  });

  bot.callbackQuery("admin:videos", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    const [completed, failed, running] = await Promise.all([
      prisma.usageRecord.count({ where: { status: "COMPLETED" } }),
      prisma.usageRecord.count({ where: { status: "FAILED" } }),
      prisma.usageRecord.count({ where: { status: { in: ["RUNNING", "PROCESSING", "DELIVERING"] } } }),
    ]);
    await ctx.answerCallbackQuery(); await ctx.reply(`🎬 *VIDEO STATISTICS*\n\n✅ Completed: ${completed}\n❌ Failed: ${failed}\n⏳ Active: ${running}`, { parse_mode: "Markdown", reply_markup: adminMenu() });
  });

  bot.callbackQuery("admin:referrals", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    const [total, granted] = await Promise.all([prisma.referral.count(), prisma.referral.count({ where: { bonusGranted: true } })]);
    await ctx.answerCallbackQuery(); await ctx.reply(`👥 *REFERRALS*\n\nTotal: ${total}\n🎁 Bonus granted: ${granted}`, { parse_mode: "Markdown", reply_markup: adminMenu() });
  });

  bot.callbackQuery("admin:user:search", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    userActions.set(ctx.from!.id, { action: "search" }); await ctx.answerCallbackQuery(); await ctx.reply("🔎 Telegram ID немесе @username жіберіңіз:");
  });

  bot.callbackQuery("admin:user:history", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    const state = userActions.get(ctx.from!.id);
    if (!state?.userId) return ctx.answerCallbackQuery({ text: "Алдымен user іздеңіз." });
    const rows = await prisma.usageRecord.findMany({ where: { userId: state.userId }, orderBy: { createdAt: "desc" }, take: 15, select: { id: true, status: true, createdAt: true, completedAt: true, creditLotId: true } });
    await ctx.answerCallbackQuery(); await ctx.reply(rows.length ? `🎬 *USAGE HISTORY*\n\n${rows.map((r, i) => `${i + 1}. ${r.status}\n${r.createdAt.toISOString()}${r.completedAt ? ` → ${r.completedAt.toISOString()}` : ""}\nCreditLot: ${r.creditLotId || "—"}`).join("\n\n")}` : "📭 Usage тарихы бос.", { parse_mode: "Markdown", reply_markup: adminUserKeyboard() });
  });

  for (const amount of [5, 10, 15] as const) {
    bot.callbackQuery(`admin:grant:${amount}`, async ctx => {
      if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
      const state = userActions.get(ctx.from!.id);
      if (!state?.userId) return ctx.answerCallbackQuery({ text: "Алдымен user таңдаңыз." });
      const user = await prisma.user.findUnique({ where: { id: state.userId } });
      if (!user) return ctx.answerCallbackQuery({ text: "User табылмады." });
      const result = await grantPurchasedCredits(prisma, user.id, amount);
      await ctx.answerCallbackQuery({ text: `+${amount} credit қосылды` }); await ctx.reply(`✅ ${amount} видео қосылды.\n👤 ${user.telegramId}\n💳 Purchase: ${result.purchase.id}`);
    });
  }

  bot.callbackQuery("admin:user:remove", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    const state = userActions.get(ctx.from!.id); if (!state?.userId) return ctx.answerCallbackQuery({ text: "Алдымен user таңдаңыз." });
    const lot = await prisma.creditLot.findFirst({ where: { userId: state.userId, remaining: { gt: 0 } }, orderBy: { createdAt: "asc" } });
    if (!lot) return ctx.answerCallbackQuery({ text: "Credit жоқ." });
    await prisma.creditLot.update({ where: { id: lot.id }, data: { remaining: { decrement: 1 } } });
    await ctx.answerCallbackQuery({ text: "-1 credit" }); await ctx.reply("✅ 1 credit алынды.");
  });

  bot.callbackQuery("admin:user:ban", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    const state = userActions.get(ctx.from!.id); if (!state?.userId) return ctx.answerCallbackQuery({ text: "Алдымен user іздеңіз." });
    userActions.set(ctx.from!.id, { action: "ban", userId: state.userId }); await ctx.answerCallbackQuery(); await ctx.reply("🚫 Ban себебін жазыңыз (немесе `-`):", { parse_mode: "Markdown" });
  });

  bot.callbackQuery("admin:user:unban", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    const state = userActions.get(ctx.from!.id); if (!state?.userId) return ctx.answerCallbackQuery({ text: "User таңдалмаған." });
    await prisma.user.update({ where: { id: state.userId }, data: { isBanned: false, banReason: null, bannedAt: null } }); userActions.set(ctx.from!.id, { action: "search", userId: state.userId }); await ctx.answerCallbackQuery({ text: "User unbanned" }); await showUser(ctx, prisma, state.userId);
  });

  bot.on("message:text", async ctx => {
    if (!isAdmin(ctx.from?.id)) return;
    const state = userActions.get(ctx.from.id);
    if (state) {
      if (["search", "credit"].includes(state.action)) {
        const user = await resolveUser(prisma, ctx.message.text);
        if (!user) return ctx.reply("❌ User табылмады. Telegram ID немесе @username қайта жіберіңіз.");
        userActions.set(ctx.from.id, { action: state.action, userId: user.id });
        if (state.action === "credit") return ctx.reply("🎟 Қанша credit қосамыз?", { reply_markup: adminCreditKeyboard() });
        return showUser(ctx, prisma, user.id);
      }
      if (state.action === "ban" && state.userId) {
        const reason = ctx.message.text.trim() === "-" ? null : ctx.message.text.trim();
        await prisma.user.update({ where: { id: state.userId }, data: { isBanned: true, banReason: reason, bannedAt: new Date() } });
        userActions.set(ctx.from.id, { action: "search", userId: state.userId }); await ctx.reply("🚫 User banned."); return showUser(ctx, prisma, state.userId);
      }
    }
    const broadcastState = pending.get(ctx.from.id); if (!broadcastState) return;
    if (broadcastState.step === "text") { broadcastState.text = ctx.message.text; broadcastState.step = "audience"; return ctx.reply("👥 Аудитория: `all`, `kk` немесе `ru`", { parse_mode: "Markdown" }); }
    if (broadcastState.step === "audience") { const audience = ctx.message.text.toLowerCase() as "all" | "kk" | "ru"; if (!["all", "kk", "ru"].includes(audience)) return ctx.reply("❌ Тек all, kk немесе ru."); broadcastState.audience = audience; broadcastState.step = "confirm"; const count = audience === "all" ? await prisma.user.count() : await prisma.user.count({ where: { language: audience } }); return ctx.reply(`👀 *PREVIEW*\n\n${broadcastState.text}\n\n👥 ${audience}\n📊 ${count} users\n\n/broadcast_confirm немесе /broadcast_cancel`, { parse_mode: "Markdown" }); }
  });

  bot.callbackQuery("admin:purchases", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    const [pendingCount, paidCount, cancelledCount, revenue] = await Promise.all([
      prisma.purchase.count({ where: { status: "PENDING" } }), prisma.purchase.count({ where: { status: "PAID" } }), prisma.purchase.count({ where: { status: "CANCELLED" } }), prisma.purchase.aggregate({ where: { status: "PAID" }, _sum: { priceKzt: true, videos: true } }),
    ]);
    await ctx.answerCallbackQuery(); await ctx.editMessageText(`📦 *PURCHASES*\n\n⏳ Pending: ${pendingCount}\n✅ Paid: ${paidCount}\n❌ Cancelled: ${cancelledCount}\n\n💰 Revenue: ${revenue._sum.priceKzt || 0} ₸\n🎬 Paid videos: ${revenue._sum.videos || 0}`, { parse_mode: "Markdown", reply_markup: purchaseKeyboard() });
  });

  for (const [key, status] of [["pending", PurchaseStatus.PENDING], ["paid", PurchaseStatus.PAID], ["cancelled", PurchaseStatus.CANCELLED]] as const) {
    bot.callbackQuery(`admin:purchases:${key}`, async ctx => { if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" }); await ctx.answerCallbackQuery(); await purchaseList(ctx, prisma, status); });
  }

  bot.callbackQuery("admin:purchases:summary", async ctx => { if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" }); const grouped = await Promise.all(["STARTER", "STANDARD", "PRO"].map(async packageName => { const result = await prisma.purchase.aggregate({ where: { status: PurchaseStatus.PAID, package: packageName as any }, _count: { _all: true }, _sum: { priceKzt: true, videos: true } }); return `${packageName}: ${result._count._all} purchases | ${result._sum.videos || 0} videos | ${result._sum.priceKzt || 0} ₸`; })); await ctx.answerCallbackQuery(); await ctx.reply(`📊 *PURCHASE SUMMARY*\n\n${grouped.join("\n")}`, { parse_mode: "Markdown", reply_markup: purchaseKeyboard() }); });

  bot.callbackQuery("admin:broadcast", async ctx => { if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" }); pending.set(ctx.from!.id, { step: "text" }); await ctx.answerCallbackQuery(); await ctx.reply("📢 *BROADCAST*\n\nЖіберілетін мәтінді енгізіңіз:", { parse_mode: "Markdown" }); });
  bot.command("broadcast_cancel", async ctx => { if (!isAdmin(ctx.from?.id)) return; pending.delete(ctx.from.id); await ctx.reply("❌ Broadcast тоқтатылды."); });
  bot.command("broadcast_confirm", async ctx => { if (!isAdmin(ctx.from?.id)) return; const state = pending.get(ctx.from.id); if (!state?.text || !state.audience) return ctx.reply("❌ Белсенді broadcast жоқ."); pending.delete(ctx.from.id); const users = await prisma.user.findMany({ where: state.audience === "all" ? {} : { language: state.audience }, select: { telegramId: true } }); let sent = 0, failed = 0; for (const user of users) { try { await ctx.api.sendMessage(user.telegramId.toString(), state.text); sent++; } catch { failed++; } await new Promise(r => setTimeout(r, 60)); } await ctx.reply(`📊 *BROADCAST RESULT*\n\n👥 ${users.length}\n✅ Sent: ${sent}\n❌ Failed: ${failed}`, { parse_mode: "Markdown" }); });

  bot.callbackQuery("admin:stats", async ctx => { if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" }); const [users, purchases, videos] = await Promise.all([prisma.user.count(), prisma.purchase.count({ where: { status: "PAID" } }), prisma.usageRecord.count({ where: { status: "COMPLETED" } })]); await ctx.answerCallbackQuery(); await ctx.editMessageText(`📊 *STATISTICS*\n\n👥 Users: ${users}\n📦 Paid purchases: ${purchases}\n🎬 Completed videos: ${videos}`, { parse_mode: "Markdown", reply_markup: adminMenu() }); });
  bot.callbackQuery("admin:back", async ctx => { if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" }); await ctx.answerCallbackQuery(); await ctx.editMessageText("🛠 *TIKTOK4K ADMIN PANEL*", { parse_mode: "Markdown", reply_markup: adminMenu() }); });
  bot.callbackQuery("admin:close", async ctx => { if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" }); await ctx.answerCallbackQuery(); await ctx.deleteMessage().catch(() => undefined); });
}
