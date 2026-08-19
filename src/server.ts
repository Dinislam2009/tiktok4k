import Fastify from "fastify";
import cors from "@fastify/cors";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { bot } from "./bot.js";

const fastify = Fastify({ logger: true });
const prisma = new PrismaClient();

await fastify.register(cors, { origin: true });

// 1. Авторизация сессиясын бастау
fastify.post("/api/auth/request", async () => {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await prisma.authSession.create({
    data: { sessionId, expiresAt },
  });

  const botUsername = "tiktokvideo4kbot"; // Өз ботыңның атын қой

  return {
    sessionId,
    botUrl: `https://t.me/${botUsername}?start=auth_${sessionId}`,
    expiresAt,
  };
});

// 2. Сессия статусын тексеру
fastify.get("/api/auth/session/:id", async (request, reply) => {
  const { id } = request.params as { id: string };

  const session = await prisma.authSession.findUnique({
    where: { sessionId: id },
    include: { user: true },
  });

  if (!session) return reply.status(404).send({ error: "SESSION_NOT_FOUND" });
  if (session.expiresAt < new Date()) return reply.status(410).send({ error: "SESSION_EXPIRED" });

  if (session.status === "APPROVED" && session.user) {
    return {
      status: "APPROVED",
      user: {
        id: session.user.id,
        telegramId: session.user.telegramId.toString(),
        username: session.user.username,
      },
    };
  }

  return { status: "PENDING" };
});

// 3. Құрылғыны тіркеу (Device Registration)
fastify.post("/api/devices/register", async (request, reply) => {
  const { userId, deviceId, name, platform } = request.body as {
    userId: string;
    deviceId: string;
    name?: string;
    platform?: string;
  };

  const existingDevice = await prisma.device.findUnique({ where: { deviceId } });

  if (existingDevice) {
    await prisma.device.update({
      where: { deviceId },
      data: { lastSeenAt: new Date() },
    });
    return { status: "OK", device: existingDevice };
  }

  const userDevicesCount = await prisma.device.count({
    where: { userId, revokedAt: null },
  });

  // Free қолданушылар үшін 1 құрылғы лимиті
  if (userDevicesCount >= 1) {
    return reply.status(403).send({
      error: "DEVICE_LIMIT_REACHED",
      message: "Тегін тарифте тек 1 құрылғы қосуға болады.",
    });
  }

  const device = await prisma.device.create({
    data: { userId, deviceId, name: name || "Desktop PC", platform: platform || "Windows" },
  });

  return { status: "REGISTERED", device };
});

// 4. Пайдаланушының тарифі мен лимитін алу
fastify.get("/api/user/status/:userId", async (request) => {
  const { userId } = request.params as { userId: string };

  const sub = await prisma.subscription.findFirst({
    where: { userId, status: "active" },
  });

  const plan = sub?.plan || "free";

  return {
    plan, // "free" немесе "pro_monthly"
    dailyLimit: plan === "pro_monthly" ? "Unlimited" : 3,
  };
});

const start = async () => {
  try {
    bot.start();
    console.log("🤖 Telegram Bot іске қосылды!");

    await fastify.listen({ port: Number(process.env.PORT) || 3000, host: "0.0.0.0" });
    console.log(`🚀 Fastify API сервер іске қосылды!`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
// 5. Видео рендер жасау лимитін тексеру және тіркеу
fastify.post("/api/usage/record", async (request, reply) => {
  const { userId, deviceId } = request.body as { userId?: string; deviceId?: string };

  if (!userId) {
    return reply.status(401).send({ error: "UNAUTHORIZED", message: "Видеоны оңтайландыру үшін Telegram арқылы кіріңіз." });
  }

  // Пайдаланушының тарифін тексеру
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: "active" },
  });
  const isPro = sub?.plan === "pro_monthly";

  if (isPro) {
    return { status: "ALLOWED" };
  }

  // Бүгінгі оңтайландырулар санын санау (00:00-ден бастап)
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const todayUsageCount = await prisma.usageRecord.count({
    where: {
      userId,
      createdAt: { gte: startOfDay },
      status: "COMPLETED",
    },
  });

  if (todayUsageCount >= 3) {
    return reply.status(403).send({
      error: "QUOTA_EXCEEDED",
      message: "Бүгінгі тегін лимитіңіз (3 видео) таусылды. PRO тарифке өтіңіз!",
    });
  }

  // Жаңа операция тіркеу
  const record = await prisma.usageRecord.create({
    data: {
      userId,
      deviceId: deviceId || "unknown",
      status: "COMPLETED",
    },
  });

  return { status: "ALLOWED", remaining: 3 - (todayUsageCount + 1), recordId: record.id };
});