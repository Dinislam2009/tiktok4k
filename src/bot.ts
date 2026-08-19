import { Bot } from "grammy";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
export const bot = new Bot(process.env.BOT_TOKEN || "");

bot.command("start", async (ctx) => {
  const payload = ctx.match; // auth_SESSION_ID

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

    // Пайдаланушыны базадан табу немесе жаңадан тіркеу
    const user = await prisma.user.upsert({
      where: { telegramId },
      update: { username },
      create: { telegramId, username },
    });

    // Сессияны РАСТАЛДЫ (APPROVED) деп жаңарту
    await prisma.authSession.update({
      where: { sessionId },
      data: {
        status: "APPROVED",
        userId: user.id,
        telegramId,
        approvedAt: new Date(),
      },
    });

    return ctx.reply("✅ Авторизация сәтті өтті! Десктоп қолданбаға қайта аласыз.");
  }

  ctx.reply("Сәлем! Social Video Optimizer ботына қош келдіңіз.");
});