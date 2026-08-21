import { InlineKeyboard } from "grammy";
import type { Bot } from "grammy";
import { PrismaClient } from "@prisma/client";
import { adminMenu } from "./keyboards.js";

const ADMIN_TELEGRAM_IDS = new Set((process.env.ADMIN_TELEGRAM_IDS || "").split(",").map(v => v.trim()).filter(Boolean));
const pending = new Map<number, { text?: string; audience?: "all" | "kk" | "ru"; step: "text" | "audience" | "confirm" }>();

export function isAdmin(telegramId?: number | bigint) { return telegramId !== undefined && ADMIN_TELEGRAM_IDS.has(String(telegramId)); }

export function registerAdminPanel(bot: Bot, prisma: PrismaClient) {
  bot.command("admin", async ctx => {
    if (!isAdmin(ctx.from?.id)) return;
    await ctx.reply("🛠 *TIKTOK4K ADMIN PANEL*", { parse_mode: "Markdown", reply_markup: adminMenu() });
  });

  bot.callbackQuery("admin:broadcast", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    pending.set(ctx.from!.id, { step: "text" });
    await ctx.answerCallbackQuery();
    await ctx.reply("📢 *BROADCAST*\n\nЖіберілетін мәтінді енгізіңіз:", { parse_mode: "Markdown" });
  });

  bot.on("message:text", async ctx => {
    if (!isAdmin(ctx.from?.id)) return;
    const state = pending.get(ctx.from.id);
    if (!state) return;

    if (state.step === "text") {
      state.text = ctx.message.text;
      state.step = "audience";
      await ctx.reply("👥 Аудиторияны таңдаңыз:\n\n`all` — барлығы\n`kk` — қазақша\n`ru` — орысша", { parse_mode: "Markdown" });
      return;
    }

    if (state.step === "audience") {
      const audience = ctx.message.text.toLowerCase() as "all" | "kk" | "ru";
      if (!["all", "kk", "ru"].includes(audience)) return ctx.reply("❌ Тек `all`, `kk` немесе `ru` жіберіңіз.");
      state.audience = audience;
      state.step = "confirm";
      const count = audience === "all" ? await prisma.user.count() : await prisma.user.count({ where: { language: audience } });
      await ctx.reply(`👀 *PREVIEW*\n\n${state.text}\n\n👥 Audience: ${audience}\n📊 Users: ${count}\n\nЖіберу үшін /broadcast_confirm, бас тарту үшін /broadcast_cancel`, { parse_mode: "Markdown" });
      return;
    }
  });

  bot.command("broadcast_cancel", async ctx => {
    if (!isAdmin(ctx.from?.id)) return;
    pending.delete(ctx.from.id);
    await ctx.reply("❌ Broadcast тоқтатылды.");
  });

  bot.command("broadcast_confirm", async ctx => {
    if (!isAdmin(ctx.from?.id)) return;
    const state = pending.get(ctx.from.id);
    if (!state?.text || !state.audience) return ctx.reply("❌ Белсенді broadcast жоқ.");
    pending.delete(ctx.from.id);

    const users = await prisma.user.findMany({ where: state.audience === "all" ? {} : { language: state.audience }, select: { telegramId: true } });
    let sent = 0, failed = 0;
    for (const user of users) {
      try {
        await ctx.api.sendMessage(user.telegramId.toString(), state.text);
        sent++;
      } catch {
        failed++;
      }
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    await ctx.reply(`📊 *BROADCAST RESULT*\n\n👥 Audience: ${users.length}\n✅ Sent: ${sent}\n❌ Failed: ${failed}`, { parse_mode: "Markdown" });
  });

  bot.callbackQuery("admin:back", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("🛠 *TIKTOK4K ADMIN PANEL*", { parse_mode: "Markdown", reply_markup: adminMenu() });
  });

  bot.callbackQuery("admin:close", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => undefined);
  });
}
