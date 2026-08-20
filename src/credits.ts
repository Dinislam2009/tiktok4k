import { Prisma, PrismaClient, CreditSource } from "@prisma/client";

const FREE_CREDITS = 2;
const FREE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TRANSACTION_RETRIES = 3;

function isTransactionConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

async function withSerializableRetry<T>(
  prisma: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (error) {
      if (!isTransactionConflict(error) || attempt === MAX_TRANSACTION_RETRIES - 1) throw error;
    }
  }

  throw new Error("Transaction retry limit reached");
}

async function ensureCurrentFreeLot(tx: Prisma.TransactionClient, userId: string, now: Date) {
  const activeFreeLot = await tx.creditLot.findFirst({
    where: {
      userId,
      source: CreditSource.FREE,
      remaining: { gt: 0 },
      expiresAt: { gt: now },
    },
    orderBy: { expiresAt: "asc" },
  });

  if (activeFreeLot) return activeFreeLot;

  const latestFreeLot = await tx.creditLot.findFirst({
    where: { userId, source: CreditSource.FREE },
    orderBy: { createdAt: "desc" },
  });

  if (!latestFreeLot || !latestFreeLot.expiresAt || latestFreeLot.expiresAt <= now) {
    const expiresAt = new Date(now.getTime() + FREE_WINDOW_MS);
    return tx.creditLot.create({
      data: {
        userId,
        source: CreditSource.FREE,
        quantity: FREE_CREDITS,
        remaining: FREE_CREDITS,
        expiresAt,
      },
    });
  }

  return null;
}

export async function reserveVideoCredit(prisma: PrismaClient, userId: string) {
  return withSerializableRetry(prisma, async (tx) => {
    // Serialize credit changes for the same user and prevent double-spending.
    await tx.user.update({ where: { id: userId }, data: { updatedAt: new Date() } });

    const now = new Date();
    const freeLot = await ensureCurrentFreeLot(tx, userId, now);

    const lots = await tx.creditLot.findMany({
      where: {
        userId,
        remaining: { gt: 0 },
        OR: [
          { source: CreditSource.FREE, expiresAt: { gt: now } },
          { source: { in: [CreditSource.REFERRAL, CreditSource.PURCHASE] } },
        ],
      },
      orderBy: { createdAt: "asc" },
    });

    const orderedLots = lots.sort((a, b) => {
      const sourcePriority = (source: CreditSource) => {
        if (source === CreditSource.FREE) return 0;
        if (source === CreditSource.REFERRAL) return 1;
        return 2;
      };
      const priorityDiff = sourcePriority(a.source) - sourcePriority(b.source);
      if (priorityDiff !== 0) return priorityDiff;
      if (a.source === CreditSource.FREE) {
        return (a.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER);
      }
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    if (freeLot && !orderedLots.some((lot) => lot.id === freeLot.id)) {
      orderedLots.unshift(freeLot);
    }

    const lot = orderedLots[0];
    if (!lot) return null;

    const updatedLot = await tx.creditLot.update({
      where: { id: lot.id },
      data: { remaining: { decrement: 1 } },
    });

    const usageRecord = await tx.usageRecord.create({
      data: {
        userId,
        creditLotId: updatedLot.id,
        status: "RUNNING",
      },
    });

    return {
      usageRecordId: usageRecord.id,
      creditLotId: updatedLot.id,
      source: updatedLot.source,
      remainingInLot: updatedLot.remaining,
    };
  });
}

export async function completeVideoUsage(prisma: PrismaClient, usageRecordId: string) {
  return prisma.usageRecord.update({
    where: { id: usageRecordId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

export async function refundVideoUsage(prisma: PrismaClient, usageRecordId: string) {
  return withSerializableRetry(prisma, async (tx) => {
    const record = await tx.usageRecord.findUnique({
      where: { id: usageRecordId },
      include: { creditLot: true },
    });

    if (!record || record.status !== "RUNNING") return record;

    if (record.creditLotId) {
      await tx.creditLot.update({
        where: { id: record.creditLotId },
        data: { remaining: { increment: 1 } },
      });
    }

    return tx.usageRecord.update({
      where: { id: usageRecordId },
      data: { status: "FAILED" },
    });
  });
}

export async function getCreditBalance(prisma: PrismaClient, userId: string) {
  return withSerializableRetry(prisma, async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { updatedAt: new Date() } });
    const now = new Date();
    await ensureCurrentFreeLot(tx, userId, now);

    const lots = await tx.creditLot.findMany({
      where: { userId, remaining: { gt: 0 } },
      orderBy: { createdAt: "asc" },
    });

    const free = lots
      .filter((lot) => lot.source === CreditSource.FREE && lot.expiresAt && lot.expiresAt > now)
      .reduce((sum, lot) => sum + lot.remaining, 0);
    const referral = lots
      .filter((lot) => lot.source === CreditSource.REFERRAL)
      .reduce((sum, lot) => sum + lot.remaining, 0);
    const purchased = lots
      .filter((lot) => lot.source === CreditSource.PURCHASE)
      .reduce((sum, lot) => sum + lot.remaining, 0);

    return { free, referral, purchased, total: free + referral + purchased };
  });
}

export async function grantReferralBonus(
  prisma: PrismaClient,
  referredUserId: string,
  referrerCode: string,
) {
  const referrer = await prisma.user.findUnique({ where: { referralCode: referrerCode } });
  if (!referrer || referrer.id === referredUserId) return false;

  try {
    return await withSerializableRetry(prisma, async (tx) => {
      const existing = await tx.referral.findUnique({ where: { referredUserId } });
      if (existing) return false;

      const referral = await tx.referral.create({
        data: {
          referrerId: referrer.id,
          referredUserId,
          bonusGranted: true,
          bonusGrantedAt: new Date(),
        },
      });

      await tx.creditLot.create({
        data: {
          userId: referrer.id,
          source: CreditSource.REFERRAL,
          quantity: 1,
          remaining: 1,
          referralId: referral.id,
        },
      });

      return true;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}
