import "dotenv/config";
import { Bot } from "grammy";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
export const bot = new Bot(process.env.BOT_TOKEN || "");

bot.command("start", async (ctx) => {
  const payload = ctx.match;

  if (payload && payload.startsWith("auth_")) {
    const sessionId = payload.replace("auth_", "");

    const session = await prisma.authSession.findUnique({
      where: { sessionId },
    });

    if (!session || session.status !== "PENDING" || session.expiresAt < new Date()) {
      return ctx.reply("❌ Авторизация сессиясы жарамсыз немесе уақыты өтіп кеткен.");
    }

    const telegramId = BigInt(ctx.from?.id || 0);
    const username = ctx.from?.username || null;

    const user = await prisma.user.upsert({
      where: { telegramId },
      update: { username },
      create: { telegramId, username },
    });

    await prisma.authSession.update({
      where: { sessionId },
      data: {
        status: "APPROVED",
        userId: user.id,
        approvedAt: new Date(),
      },
    });

    return ctx.reply("✅ Авторизация сәтті өтті! Десктоп қолданбаға қайта аласыз.");
  }

  await ctx.reply("Сәлем! Social Video Optimizer ботына қош келдіңіз.");
});