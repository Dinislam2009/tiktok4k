import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import cors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { bot } from "./bot.js";

if (!process.env.BOT_TOKEN) {
  console.error("❌ КРИТИКАЛЫҚ ҚАТЕ: BOT_TOKEN .env файлында көрсетілмеген!");
  process.exit(1);
}

const fastify = Fastify({ logger: true });
const prisma = new PrismaClient();

// 1. CORS Баптауы
await fastify.register(cors, {
  origin: process.env.NODE_ENV === "production"
    ? ["http://localhost:5173", "http://127.0.0.1:5173"]
    : true,
});

// 2. Rate Limiter (DoS/Spam қорғанысы)
await fastify.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
});

// 3. JWT Аутентификация
await fastify.register(fastifyJwt, {
  secret: process.env.JWT_SECRET || "super_secret_jwt_key_tiktok4k_2026",
});

// Авторизацияны тексеру функциясы (onRequest хук)
const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.status(401).send({
      error: "UNAUTHORIZED",
      message: "Аутентификация токені жоқ немесе жарамсыз.",
    });
  }
};

// 1. Авторизация сессиясын бастау
fastify.post(
  "/api/auth/request",
  {
    config: {
      rateLimit: { max: 30, timeWindow: "1 minute" },
    },
  },
  async () => {
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
  }
);

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
    const token = fastify.jwt.sign(
      { id: session.user.id, telegramId: session.user.telegramId.toString() },
      { expiresIn: "30d" }
    );

    return {
      status: "APPROVED",
      token,
      user: {
        id: session.user.id,
        telegramId: session.user.telegramId.toString(),
        username: session.user.username,
      },
    };
  }

  return { status: "PENDING" };
});

// 3. Құрылғыны тіркеу
fastify.post(
  "/api/devices/register",
  { onRequest: [authenticate] },
  async (request, reply) => {
    const userId = (request.user as { id: string }).id;
    const { deviceId, name, platform } = request.body as {
      deviceId: string;
      name?: string;
      platform?: string;
    };

    if (!deviceId) {
      return reply.status(400).send({ error: "MISSING_DEVICE_ID" });
    }

    const existingDevice = await prisma.device.findUnique({ where: { deviceId } });

    if (existingDevice) {
      if (existingDevice.userId !== userId) {
        return reply.status(403).send({ error: "DEVICE_BELONGS_TO_ANOTHER_USER" });
      }
      await prisma.device.update({
        where: { deviceId },
        data: { lastSeenAt: new Date() },
      });
      return { status: "OK", device: existingDevice };
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
      data: { userId, deviceId, name: name || "Desktop PC", platform: platform || "Windows" },
    });

    return { status: "REGISTERED", device };
  }
);

// 4. Пайдаланушының тарифі мен лимитін алу
fastify.get(
  "/api/user/status",
  { onRequest: [authenticate] },
  async (request) => {
    const userId = (request.user as { id: string }).id;

    const sub = await prisma.subscription.findFirst({
      where: { userId, status: "active" },
    });

    const plan = sub?.plan || "free";

    return {
      plan,
      dailyLimit: plan === "pro_monthly" ? "Unlimited" : 3,
    };
  }
);

// 5. Видео рендер жасау лимитін тексеру
fastify.post(
  "/api/usage/record",
  { onRequest: [authenticate] },
  async (request, reply) => {
    const userId = (request.user as { id: string }).id;
    const { deviceId } = request.body as { deviceId?: string };

    const sub = await prisma.subscription.findFirst({
      where: { userId, status: "active" },
    });
    const isPro = sub?.plan === "pro_monthly";

    if (isPro) {
      return { status: "ALLOWED" };
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    try {
      const result = await prisma.$transaction(async (tx) => {
        const todayUsageCount = await tx.usageRecord.count({
          where: {
            userId,
            createdAt: { gte: startOfDay },
            status: "COMPLETED",
          },
        });

        if (todayUsageCount >= 3) {
          throw new Error("QUOTA_EXCEEDED");
        }

        const record = await tx.usageRecord.create({
          data: {
            userId,
            deviceId: deviceId || "unknown",
            status: "COMPLETED",
          },
        });

        return { remaining: 3 - (todayUsageCount + 1), recordId: record.id };
      });

      return { status: "ALLOWED", ...result };
    } catch (err) {
      if ((err as Error).message === "QUOTA_EXCEEDED") {
        return reply.status(403).send({
          error: "QUOTA_EXCEEDED",
          message: "Бүгінгі тегін лимитіңіз (3 видео) таусылды. PRO тарифке өтіңіз!",
        });
      }
      throw err;
    }
  }
);

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