import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { bot } from "./bot.js";

const fastify = Fastify({ logger: true });
const prisma = new PrismaClient();

await fastify.register(cors, { origin: true });

// Render Health Check маршруты
fastify.get("/", async () => {
  return { status: "ok", message: "TikTok 4K API is running" };
});

// Telegram WebApp арқылы тікелей авто-авторизация жасау маршруты
fastify.post("/api/auth/telegram-webapp", async (request, reply) => {
  const { telegramId, username } = request.body as { telegramId?: string; username?: string };
  if (!telegramId) return reply.status(400).send({ error: "INVALID_REQUEST" });

  try {
    const tgIdBigInt = BigInt(telegramId);
    const user = await prisma.user.upsert({
      where: { telegramId: tgIdBigInt },
      update: { username: username || null },
      create: { telegramId: tgIdBigInt, username: username || null },
    });

    return {
      status: "APPROVED",
      user: {
        id: user.id,
        telegramId: user.telegramId.toString(),
        username: user.username,
      },
    };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: "AUTH_FAILED" });
  }
});

fastify.post("/api/auth/request", async () => {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await prisma.authSession.create({
    data: { sessionId, expiresAt },
  });

  const botUsername = "tiktokvideo4kbot";

  return {
    sessionId,
    botUrl: `https://t.me/${botUsername}?start=auth_${sessionId}`,
    expiresAt,
  };
});

fastify.get("/api/auth/session/:id", async (request, reply) => {
  const { id } = request.params as { id: string };

  const session = await prisma.authSession.findUnique({
    where: { sessionId: id },
    include: { user: true },
  });

  if (!session) return reply.status(404).send({ error: "SESSION_NOT_FOUND" });

  if (session.expiresAt < new Date()) {
    if (session.status === "PENDING") {
      await prisma.authSession.update({
        where: { sessionId: id },
        data: { status: "EXPIRED" },
      });
    }
    return reply.status(410).send({ error: "SESSION_EXPIRED" });
  }

  if ((session.status === "APPROVED" || session.status === "authenticated") && session.user) {
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

fastify.post("/api/devices/register", async (request, reply) => {
  const { userId, deviceId, name, platform } = request.body as {
    userId?: string;
    deviceId?: string;
    name?: string;
    platform?: string;
  };

  if (!userId || !deviceId) return reply.status(400).send({ error: "INVALID_REQUEST" });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return reply.status(404).send({ error: "USER_NOT_FOUND" });

  const existingDevice = await prisma.device.findUnique({ where: { deviceId } });

  if (existingDevice) {
    if (existingDevice.userId !== userId) {
      return reply.status(403).send({ error: "DEVICE_OWNED_BY_ANOTHER_USER" });
    }
    if (existingDevice.revokedAt) return reply.status(403).send({ error: "DEVICE_REVOKED" });

    const device = await prisma.device.update({
      where: { deviceId },
      data: { lastSeenAt: new Date(), name, platform },
    });

    return { status: "OK", device };
  }

  const userDevicesCount = await prisma.device.count({
    where: { userId, revokedAt: null },
  });

  if (userDevicesCount >= 1) {
    return reply.status(403).send({
      error: "DEVICE_LIMIT_REACHED",
      message: "Тегін тарифте тек 1 құрылғы қосуға болады.",
    });
  }

  const device = await prisma.device.create({
    data: {
      userId,
      deviceId,
      name: name || "Desktop PC",
      platform: platform || "Windows",
    },
  });

  return { status: "REGISTERED", device };
});

fastify.get("/api/user/status/:userId", async (request, reply) => {
  const { userId } = request.params as { userId: string };
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return reply.status(404).send({ error: "USER_NOT_FOUND" });

  const sub = await prisma.subscription.findFirst({
    where: { userId, status: "active" },
  });

  const plan = sub?.plan || "free";
  return { plan, dailyLimit: plan === "pro_monthly" ? "Unlimited" : 3 };
});

fastify.post("/api/usage/record", async (request, reply) => {
  const { userId, deviceId } = request.body as { userId?: string; deviceId?: string };

  if (!userId || !deviceId) {
    return reply.status(401).send({
      error: "UNAUTHORIZED",
      message: "Видеоны оңтайландыру үшін Telegram арқылы кіріңіз.",
    });
  }

  const device = await prisma.device.findUnique({ where: { deviceId } });
  if (!device || device.userId !== userId || device.revokedAt) {
    return reply.status(403).send({ error: "INVALID_DEVICE" });
  }

  const sub = await prisma.subscription.findFirst({ where: { userId, status: "active" } });
  if (sub?.plan === "pro_monthly") return { status: "ALLOWED", unlimited: true };

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const todayUsageCount = await tx.usageRecord.count({
        where: {
          userId,
          createdAt: { gte: startOfDay, lt: endOfDay },
          status: { in: ["RUNNING", "COMPLETED"] },
        },
      });

      if (todayUsageCount >= 3) return null;

      const record = await tx.usageRecord.create({
        data: { userId, deviceId, status: "RUNNING" },
      });

      return { recordId: record.id, remaining: 3 - (todayUsageCount + 1) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (!result) {
      return reply.status(403).send({
        error: "QUOTA_EXCEEDED",
        message: "Бүгінгі тегін лимитіңіз (3 видео) таусылды. PRO тарифке өтіңіз!",
      });
    }

    return { status: "ALLOWED", ...result };
  } catch (error) {
    fastify.log.error(error);
    return reply.status(409).send({
      error: "USAGE_RESERVATION_CONFLICT",
      message: "Лимитті тексеру кезінде қақтығыс болды. Қайта көріңіз.",
    });
  }
});

fastify.post("/api/usage/complete", async (request, reply) => {
  const { userId, recordId } = request.body as { userId?: string; recordId?: string };
  if (!userId || !recordId) return reply.status(400).send({ error: "INVALID_REQUEST" });

  const record = await prisma.usageRecord.findUnique({ where: { id: recordId } });
  if (!record || record.userId !== userId) return reply.status(404).send({ error: "USAGE_RECORD_NOT_FOUND" });
  if (record.status !== "RUNNING") return reply.status(409).send({ error: "USAGE_RECORD_NOT_RUNNING" });

  await prisma.usageRecord.update({
    where: { id: recordId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });

  return { status: "COMPLETED" };
});

fastify.post("/api/usage/fail", async (request, reply) => {
  const { userId, recordId } = request.body as { userId?: string; recordId?: string };
  if (!userId || !recordId) return reply.status(400).send({ error: "INVALID_REQUEST" });

  const record = await prisma.usageRecord.findUnique({ where: { id: recordId } });
  if (!record || record.userId !== userId) return reply.status(404).send({ error: "USAGE_RECORD_NOT_FOUND" });
  if (record.status !== "RUNNING") return reply.status(409).send({ error: "USAGE_RECORD_NOT_RUNNING" });

  await prisma.usageRecord.update({ where: { id: recordId }, data: { status: "FAILED" } });
  return { status: "FAILED" };
});

const start = async () => {
  try {
    bot.start().catch((err) => {
      console.error("Telegram Bot іске қосу кезіндегі қателік:", err.message);
    });
    console.log("🤖 Telegram Bot ортасы бапталды!");

    await fastify.listen({ port: Number(process.env.PORT) || 3000, host: "0.0.0.0" });
    console.log("🚀 Fastify API сервер іске қосылды!");
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();