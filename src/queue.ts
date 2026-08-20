import { Queue } from "bullmq";
import Redis from "ioredis";
import "dotenv/config";

const rawUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const redisUrl = rawUrl.trim().replace(/^["']|["']$/g, "");

export const redisConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  tls: redisUrl.startsWith("rediss://") ? { rejectUnauthorized: false } : undefined,
});

export const videoQueue = new Queue("video-processing", {
  connection: redisConnection,
});