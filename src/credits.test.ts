import assert from "node:assert/strict";
import { CreditSource, PurchasePackage, PurchaseStatus } from "@prisma/client";
import {
  completeVideoUsage,
  getCreditBalance,
  grantPurchasedCredits,
  refundVideoUsage,
  recoverStaleVideoUsages,
  reserveVideoCredit,
} from "./credits";

type User = { id: string; updatedAt: Date };
type Lot = {
  id: string;
  userId: string;
  source: CreditSource;
  quantity: number;
  remaining: number;
  expiresAt: Date | null;
  purchaseId: string | null;
  referralId: string | null;
  createdAt: Date;
};
type Usage = {
  id: string;
  userId: string;
  creditLotId: string | null;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
};
type Purchase = {
  id: string;
  userId: string;
  package: PurchasePackage;
  videos: number;
  priceKzt: number;
  status: PurchaseStatus;
  paidAt: Date | null;
};

class FakePrisma {
  users = new Map<string, User>();
  lots: Lot[] = [];
  usages: Usage[] = [];
  purchases: Purchase[] = [];
  referrals: unknown[] = [];
  private seq = 0;

  private id(prefix: string) {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  private matches<T extends Record<string, any>>(row: T, where: Record<string, any>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (key === "OR") return value.some((item: Record<string, any>) => this.matches(row, item));
      if (key === "id" && value?.notIn) return !value.notIn.includes(row[key]);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        if ("gt" in value) return row[key] > value.gt;
        if ("lt" in value) return row[key] < value.lt;
        if ("in" in value) return value.in.includes(row[key]);
      }
      return row[key] === value;
    });
  }

  private order<T extends Record<string, any>>(rows: T[], orderBy?: Record<string, string>) {
    if (!orderBy) return rows;
    const [key, direction] = Object.entries(orderBy)[0];
    return rows.sort((a, b) => {
      const av = a[key] instanceof Date ? a[key].getTime() : a[key];
      const bv = b[key] instanceof Date ? b[key].getTime() : b[key];
      return (av < bv ? -1 : av > bv ? 1 : 0) * (direction === "desc" ? -1 : 1);
    });
  }

  user = {
    update: async: any,
  };

  $transaction = async <T>(operation: (tx: any) => Promise<T>) => operation(this.tx);

  tx = {
    user: {
      update: async ({ where, data }: any) => {
        const user = this.users.get(where.id);
        if (!user) throw new Error("user not found");
        Object.assign(user, data);
        return user;
      },
      findUnique: async ({ where }: any) => this.users.get(where.id) ?? null,
    },
    creditLot: {
      findFirst: async ({ where, orderBy }: any) => {
        const rows = this.order(this.lots.filter((row) => this.matches(row, where)), orderBy);
        return rows[0] ?? null;
      },
      findMany: async ({ where, orderBy }: any) => {
        const rows = where ? this.lots.filter((row) => this.matches(row, where)) : [...this.lots];
        return this.order(rows, orderBy);
      },
      create: async ({ data }: any) => {
        const now = new Date();
        const lot: Lot = {
          id: this.id("lot"),
          userId: data.userId,
          source: data.source,
          quantity: data.quantity,
          remaining: data.remaining,
          expiresAt: data.expiresAt ?? null,
          purchaseId: data.purchaseId ?? null,
          referralId: data.referralId ?? null,
          createdAt: now,
        };
        this.lots.push(lot);
        return lot;
      },
      update: async ({ where, data }: any) => {
        const lot = this.lots.find((row) => row.id === where.id);
        if (!lot) throw new Error("lot not found");
        if (data.remaining?.decrement) lot.remaining -= data.remaining.decrement;
        if (data.remaining?.increment) lot.remaining += data.remaining.increment;
        return lot;
      },
    },
    usageRecord: {
      findUnique: async ({ where }: any) => this.usages.find((row) => row.id === where.id) ?? null,
      findMany: async ({ where, select }: any) => {
        const rows = this.usages.filter((row) => this.matches(row, where));
        if (!select) return rows;
        return rows.map((row) => ({ id: row.id }));
      },
      create: async ({ data }: any) => {
        const usage: Usage = {
          id: this.id("usage"),
          userId: data.userId,
          creditLotId: data.creditLotId ?? null,
          status: data.status,
          createdAt: new Date(),
          completedAt: null,
        };
        this.usages.push(usage);
        return usage;
      },
      update: async ({ where, data }: any) => {
        const usage = this.usages.find((row) => row.id === where.id);
        if (!usage) throw new Error("usage not found");
        Object.assign(usage, data);
        return usage;
      },
    },
    purchase: {
      create: async ({ data }: any) => {
        const purchase: Purchase = {
          id: this.id("purchase"),
          userId: data.userId,
          package: data.package,
          videos: data.videos,
          priceKzt: data.priceKzt,
          status: data.status,
          paidAt: data.paidAt,
        };
        this.purchases.push(purchase);
        return purchase;
      },
    },
    referral: {
      findUnique: async () => null,
      create: async ({ data }: any) => {
        const referral = { id: this.id("referral"), ...data };
        this.referrals.push(referral);
        return referral;
      },
    },
  };
}

function addUser(prisma: FakePrisma, id: string) {
  prisma.users.set(id, { id, updatedAt: new Date() });
}

async function main() {
  const prisma = new FakePrisma();
  addUser(prisma, "user-1");

  const first = await reserveVideoCredit(prisma as any, "user-1");
  assert(first, "first reservation should succeed");
  assert.equal(first.remainingInLot, 1);
  assert.equal((await getCreditBalance(prisma as any, "user-1")).total, 1);

  await completeVideoUsage(prisma as any, first.usageRecordId);
  assert.equal((await getCreditBalance(prisma as any, "user-1")).total, 1);

  const second = await reserveVideoCredit(prisma as any, "user-1");
  assert(second, "second reservation should succeed");
  assert.equal(second.remainingInLot, 0);
  await completeVideoUsage(prisma as any, second.usageRecordId);
  assert.equal((await getCreditBalance(prisma as any, "user-1")).total, 0);

  const third = await reserveVideoCredit(prisma as any, "user-1");
  assert.equal(third, null, "third reservation must be rejected after 2 free credits are consumed");

  addUser(prisma, "user-2");
  const failed = await reserveVideoCredit(prisma as any, "user-2");
  assert(failed, "failed-test reservation should succeed");
  assert.equal((await getCreditBalance(prisma as any, "user-2")).total, 1);
  await refundVideoUsage(prisma as any, failed.usageRecordId);
  assert.equal((await getCreditBalance(prisma as any, "user-2")).total, 2);
  await refundVideoUsage(prisma as any, failed.usageRecordId);
  assert.equal((await getCreditBalance(prisma as any, "user-2")).total, 2, "refund must be idempotent");

  addUser(prisma, "user-3");
  const stale = await reserveVideoCredit(prisma as any, "user-3");
  assert(stale, "stale-test reservation should succeed");
  const staleUsage = prisma.usages.find((row) => row.id === stale.usageRecordId)!;
  staleUsage.createdAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const recovered = await recoverStaleVideoUsages(prisma as any, 2 * 60 * 60 * 1000);
  assert.equal(recovered, 1);
  assert.equal((await getCreditBalance(prisma as any, "user-3")).total, 2);
  assert.equal(await recoverStaleVideoUsages(prisma as any, 2 * 60 * 60 * 1000), 0);

  addUser(prisma, "user-4");
  const purchase = await grantPurchasedCredits(prisma as any, "user-4", 5);
  assert.equal(purchase.creditLot.quantity, 5);
  assert.equal((await getCreditBalance(prisma as any, "user-4")).purchased, 5);

  console.log("CREDIT TESTS: PASS");
  console.log("- reserve/complete lifecycle: PASS");
  console.log("- exhausted free balance: PASS");
  console.log("- refund lifecycle: PASS");
  console.log("- idempotent refund: PASS");
  console.log("- stale usage recovery: PASS");
  console.log("- purchased credits: PASS");
}

main().catch((error) => {
  console.error("CREDIT TESTS: FAIL");
  console.error(error);
  process.exitCode = 1;
});
