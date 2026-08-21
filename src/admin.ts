import { InlineKeyboard } from "grammy";
import type { Bot } from "grammy";
import { PrismaClient } from "@prisma/client";
import { grantPurchasedCredits } from "./credits.js";
import { adminCreditKeyboard, adminMenu } from "./keyboards.js";

const ADMIN_TELEGRAM_IDS = new Set(
  (process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

export function isAdmin(telegramId?: number | bigint) {
  if (telegramId === undefined) return false;
  return ADMIN_TELEGRAM_IDS.has(String(telegramId));
}

export function registerAdminPanel(bot: Bot, prisma: PrismaClient) {
  bot.command("admin", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    await ctx.reply("🛠 *TIKTOK4K ADMIN PANEL*\n\nБасқару бөлімін таңдаңыз:", {
      parse_mode: "Markdown",
      reply_markup: adminMenu(),
    });
  });

  bot.callbackQuery("admin:stats", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    const [users, completed, failed, running, purchases, credits] = await Promise.all([
      prisma.user.count(),
      prisma.usageRecord.count({ where: { status: "COMPLETED" } }),
      prisma.usageRecord.count({ where: { status: "FAILED" } }),
      prisma.usageRecord.count({ where: { status: "RUNNING" } }),
      prisma.purchase.count({ where: { status: "PAID" } }),
      prisma.creditLot.aggregate({ _sum: { quantity: true, remaining: true } }),
    ]);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `📊 *STATISTICS*\n\n👥 Users: *${users}*\n\n🎬 Completed: *${completed}*\n❌ Failed: *${failed}*\n⏳ Running: *${running}*\n\n💳 Paid purchases: *${purchases}*\n🎁 Total credits: *${credits._sum.quantity || 0}*\n📦 Remaining credits: *${credits._sum.remaining || 0}*`,
      { parse_mode: "Markdown", reply_markup: adminMenu() },
    );
  });

  bot.callbackQuery("admin:users", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    const [total, recent] = await Promise.all([
      prisma.user.count(),
      prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 10, select: { telegramId: true, username: true, language: true, createdAt: true } }),
    ]);
    await ctx.answerCallbackQuery();
    const rows = recent.map((u) => `• ${u.username ? "@" + u.username : "—"} | ${u.telegramId} | ${u.language}`).join("\n") || "—";
    await ctx.editMessageText(`👥 *USERS: ${total}*\n\nСоңғы 10:\n${rows}`, { parse_mode: "Markdown", reply_markup: adminMenu() });
  });

  bot.callbackQuery("admin:credits", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("💳 *CREDIT MANAGEMENT*\n\nАлдымен қолданушының Telegram ID-сін /grant командасы арқылы немесе төмендегі пакет логикасымен басқарыңыз.", { parse_mode: "Markdown", reply_markup: adminCreditKeyboard() });
  });

  for (const amount of [5, 10, 15] as const) {
    bot.callbackQuery(`admin:grant:${amount}`, async (ctx) => {
      if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
      await ctx.answerCallbackQuery({ text: `${amount} видео таңдалды` });
      await ctx.reply(`➕ ${amount} видео қосу үшін қолданушының Telegram ID-сін жіберіңіз.\n\nМысалы: /grant <telegramId> ${amount}`);
    });
  }

  bot.callbackQuery("admin:purchases", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    const [pending, paid, cancelled] = await Promise.all([
      prisma.purchase.count({ where: { status: "PENDING" } }),
      prisma.purchase.count({ where: { status: "PAID" } }),
      prisma.purchase.count({ where: { status: "CANCELLED" } }),
    ]);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`📦 *PURCHASES*\n\n⏳ Pending: ${pending}\n✅ Paid: ${paid}\n❌ Cancelled: ${cancelled}`, { parse_mode: "Markdown", reply_markup: adminMenu() });
  });

  bot.callbackQuery("admin:videos", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    const [total, completed, failed] = await Promise.all([
      prisma.usageRecord.count(),
      prisma.usageRecord.count({ where: { status: "COMPLETED" } }),
      prisma.usageRecord.count({ where: { status: "FAILED" } }),
    ]);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`🎬 *VIDEO STATISTICS*\n\nTotal: ${total}\n✅ Completed: ${completed}\n❌ Failed: ${failed}`, { parse_mode: "Markdown", reply_markup: adminMenu() });
  });

  bot.callbackQuery("admin:referrals", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    const [total, granted] = await Promise.all([
      prisma.referral.count(),
      prisma.referral.count({ where: { bonusGranted: true } }),
    ]);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`👥 *REFERRALS*\n\nTotal referrals: ${total}\n🎁 Bonuses granted: ${granted}`, { parse_mode: "Markdown", reply_markup: adminMenu() });
  });

  bot.callbackQuery("admin:broadcast", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    await ctx.answerCallbackQuery();
    await ctx.reply("📢 Broadcast функциясы келесі қадамда қосылады. Алдымен хабарлама мәтінін енгізу режимін жасаймыз.");
  });

  bot.callbackQuery("admin:back", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("🛠 *TIKTOK4K ADMIN PANEL*\n\nБасқару бөлімін таңдаңыз:", { parse_mode: "Markdown", reply_markup: adminMenu() });
  });

  bot.callbackQuery("admin:close", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => undefined);
  });
}
