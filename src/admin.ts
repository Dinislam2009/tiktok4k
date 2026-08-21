import { InlineKeyboard } from "grammy";
import type { Bot } from "grammy";
import { PrismaClient, PurchaseStatus } from "@prisma/client";
import { adminMenu } from "./keyboards.js";

const ADMIN_TELEGRAM_IDS = new Set((process.env.ADMIN_TELEGRAM_IDS || "").split(",").map(v => v.trim()).filter(Boolean));
const pending = new Map<number, { text?: string; audience?: "all" | "kk" | "ru"; step: "text" | "audience" | "confirm" }>();

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

export function registerAdminPanel(bot: Bot, prisma: PrismaClient) {
  bot.command("admin", async ctx => { if (!isAdmin(ctx.from?.id)) return; await ctx.reply("🛠 *TIKTOK4K ADMIN PANEL*", { parse_mode: "Markdown", reply_markup: adminMenu() }); });

  bot.callbackQuery("admin:purchases", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    const [pendingCount, paidCount, cancelledCount, revenue] = await Promise.all([
      prisma.purchase.count({ where: { status: "PENDING" } }),
      prisma.purchase.count({ where: { status: "PAID" } }),
      prisma.purchase.count({ where: { status: "CANCELLED" } }),
      prisma.purchase.aggregate({ where: { status: "PAID" }, _sum: { priceKzt: true, videos: true } }),
    ]);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`📦 *PURCHASES*\n\n⏳ Pending: ${pendingCount}\n✅ Paid: ${paidCount}\n❌ Cancelled: ${cancelledCount}\n\n💰 Revenue: ${revenue._sum.priceKzt || 0} ₸\n🎬 Paid videos: ${revenue._sum.videos || 0}`, { parse_mode: "Markdown", reply_markup: purchaseKeyboard() });
  });

  for (const [key, status] of [["pending", PurchaseStatus.PENDING], ["paid", PurchaseStatus.PAID], ["cancelled", PurchaseStatus.CANCELLED]] as const) {
    bot.callbackQuery(`admin:purchases:${key}`, async ctx => {
      if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
      await ctx.answerCallbackQuery();
      await purchaseList(ctx, prisma, status);
    });
  }

  bot.callbackQuery("admin:purchases:summary", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    const grouped = await Promise.all(["STARTER", "STANDARD", "PRO"].map(async packageName => {
      const result = await prisma.purchase.aggregate({ where: { status: PurchaseStatus.PAID, package: packageName as any }, _count: { _all: true }, _sum: { priceKzt: true, videos: true } });
      return `${packageName}: ${result._count._all} purchases | ${result._sum.videos || 0} videos | ${result._sum.priceKzt || 0} ₸`;
    }));
    await ctx.answerCallbackQuery();
    await ctx.reply(`📊 *PURCHASE SUMMARY*\n\n${grouped.join("\n")}`, { parse_mode: "Markdown", reply_markup: purchaseKeyboard() });
  });

  bot.callbackQuery("admin:broadcast", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    pending.set(ctx.from!.id, { step: "text" }); await ctx.answerCallbackQuery(); await ctx.reply("📢 *BROADCAST*\n\nЖіберілетін мәтінді енгізіңіз:", { parse_mode: "Markdown" });
  });
  bot.on("message:text", async ctx => {
    if (!isAdmin(ctx.from?.id)) return;
    const state = pending.get(ctx.from.id); if (!state) return;
    if (state.step === "text") { state.text = ctx.message.text; state.step = "audience"; return ctx.reply("👥 Аудитория: `all`, `kk` немесе `ru`", { parse_mode: "Markdown" }); }
    if (state.step === "audience") { const audience = ctx.message.text.toLowerCase() as "all" | "kk" | "ru"; if (!["all", "kk", "ru"].includes(audience)) return ctx.reply("❌ Тек all, kk немесе ru."); state.audience = audience; state.step = "confirm"; const count = audience === "all" ? await prisma.user.count() : await prisma.user.count({ where: { language: audience } }); return ctx.reply(`👀 *PREVIEW*\n\n${state.text}\n\n👥 ${audience}\n📊 ${count} users\n\n/broadcast_confirm немесе /broadcast_cancel`, { parse_mode: "Markdown" }); }
  });
  bot.command("broadcast_cancel", async ctx => { if (!isAdmin(ctx.from?.id)) return; pending.delete(ctx.from.id); await ctx.reply("❌ Broadcast тоқтатылды."); });
  bot.command("broadcast_confirm", async ctx => {
    if (!isAdmin(ctx.from?.id)) return; const state = pending.get(ctx.from.id); if (!state?.text || !state.audience) return ctx.reply("❌ Белсенді broadcast жоқ."); pending.delete(ctx.from.id);
    const users = await prisma.user.findMany({ where: state.audience === "all" ? {} : { language: state.audience }, select: { telegramId: true } }); let sent = 0, failed = 0;
    for (const user of users) { try { await ctx.api.sendMessage(user.telegramId.toString(), state.text); sent++; } catch { failed++; } await new Promise(r => setTimeout(r, 60)); }
    await ctx.reply(`📊 *BROADCAST RESULT*\n\n👥 ${users.length}\n✅ Sent: ${sent}\n❌ Failed: ${failed}`, { parse_mode: "Markdown" });
  });

  bot.callbackQuery("admin:stats", async ctx => { if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" }); const [users, purchases, videos] = await Promise.all([prisma.user.count(), prisma.purchase.count({ where: { status: "PAID" } }), prisma.usageRecord.count({ where: { status: "COMPLETED" } })]); await ctx.answerCallbackQuery(); await ctx.editMessageText(`📊 *STATISTICS*\n\n👥 Users: ${users}\n📦 Paid purchases: ${purchases}\n🎬 Completed videos: ${videos}`, { parse_mode: "Markdown", reply_markup: adminMenu() }); });
  bot.callbackQuery("admin:back", async ctx => { if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" }); await ctx.answerCallbackQuery(); await ctx.editMessageText("🛠 *TIKTOK4K ADMIN PANEL*", { parse_mode: "Markdown", reply_markup: adminMenu() }); });
  bot.callbackQuery("admin:close", async ctx => { if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" }); await ctx.answerCallbackQuery(); await ctx.deleteMessage().catch(() => undefined); });
}
