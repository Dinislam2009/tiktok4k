import "dotenv/config";[cite: 4]
import { Bot } from "grammy";[cite: 4]
import { PrismaClient } from "@prisma/client";[cite: 4]

const prisma = new PrismaClient();[cite: 4]
export const bot = new Bot(process.env.BOT_TOKEN || "");[cite: 4]

bot.command("start", async (ctx) => {[cite: 4]
  const payload = ctx.match;[cite: 4]

  if (payload && payload.startsWith("auth_")) {[cite: 4]
    const sessionId = payload.replace("auth_", "");[cite: 4]

    const session = await prisma.authSession.findUnique({[cite: 4]
      where: { sessionId },[cite: 4]
    });[cite: 4]

    if (!session || session.status !== "PENDING" || session.expiresAt < new Date()) {[cite: 4]
      return ctx.reply("❌ Авторизация сессиясы жарамсыз немесе уақыты өтіп кеткен.");[cite: 4]
    }[cite: 4]

    const telegramId = BigInt(ctx.from?.id || 0);[cite: 4]
    const username = ctx.from?.username || null;[cite: 4]

    // 1. Қолданушыны табу немесе жасау
    const user = await prisma.user.upsert({[cite: 4]
      where: { telegramId },[cite: 4]
      update: { username },[cite: 4]
      create: { telegramId, username },[cite: 4]
    });[cite: 4]

    // 2. Сессияны мақұлдау (telegramId тек User моделінде болатындықтан, мұнда тек userId қолданылады)
    await prisma.authSession.update({[cite: 4]
      where: { sessionId },[cite: 4]
      data: {[cite: 4]
        status: "APPROVED",[cite: 4]
        userId: user.id,[cite: 4]
        approvedAt: new Date(),[cite: 4]
      },[cite: 4]
    });[cite: 4]

    return ctx.reply("✅ Авторизация сәтті өтті! Десктоп қолданбаға қайта аласыз.");[cite: 4]
  }[cite: 4]

  await ctx.reply("Сәлем! Social Video Optimizer ботына қош келдіңіз.");[cite: 4]
});[cite: 4]