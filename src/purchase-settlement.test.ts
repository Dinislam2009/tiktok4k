import assert from "node:assert/strict";
import { CreditSource, PurchasePackage, PurchaseStatus } from "@prisma/client";
import { settlePaidPurchase } from "./credits";

type Purchase = {
  id: string;
  userId: string;
  package: PurchasePackage;
  videos: number;
  priceKzt: number;
  status: PurchaseStatus;
  paymentProviderId: string | null;
  paidAt: Date | null;
};

type Lot = {
  id: string;
  userId: string;
  source: CreditSource;
  quantity: number;
  remaining: number;
  purchaseId: string | null;
};

class FakePrisma {
  purchases: Purchase[] = [];
  lots: Lot[] = [];
  private sequence = 0;

  private id(prefix: string) {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  $transaction = async <T>(operation: (tx: any) => Promise<T>) => operation(this.tx);

  tx = {
    purchase: {
      findUnique: async ({ where }: any) => {
        const purchase = where.id
          ? this.purchases.find((item) => item.id === where.id)
          : this.purchases.find((item) => item.paymentProviderId === where.paymentProviderId);
        if (!purchase) return null;
        return {
          ...purchase,
          creditLot: this.lots.find((lot) => lot.purchaseId === purchase.id) ?? null,
        };
      },
      update: async ({ where, data }: any) => {
        const purchase = this.purchases.find((item) => item.id === where.id);
        if (!purchase) throw new Error("purchase not found");
        Object.assign(purchase, data);
        return purchase;
      },
    },
    creditLot: {
      create: async ({ data }: any) => {
        const lot: Lot = {
          id: this.id("lot"),
          userId: data.userId,
          source: data.source,
          quantity: data.quantity,
          remaining: data.remaining,
          purchaseId: data.purchaseId ?? null,
        };
        this.lots.push(lot);
        return lot;
      },
    },
  };
}

async function main() {
  const prisma = new FakePrisma();
  prisma.purchases.push({
    id: "purchase-1",
    userId: "user-1",
    package: PurchasePackage.STANDARD,
    videos: 10,
    priceKzt: 999,
    status: PurchaseStatus.PENDING,
    paymentProviderId: null,
    paidAt: null,
  });

  const first = await settlePaidPurchase(prisma as any, "purchase-1", "provider-1");
  assert.equal(first.alreadySettled, false);
  assert.equal(first.purchase.status, PurchaseStatus.PAID);
  assert.equal(first.creditLot?.quantity, 10);
  assert.equal(prisma.lots.length, 1);
  assert.equal(prisma.lots[0].remaining, 10);

  const second = await settlePaidPurchase(prisma as any, "purchase-1", "provider-1");
  assert.equal(second.alreadySettled, true);
  assert.equal(second.creditLot?.id, first.creditLot?.id);
  assert.equal(prisma.lots.length, 1, "second settlement must not create another credit lot");
  assert.equal(prisma.lots[0].remaining, 10, "second settlement must not duplicate credits");

  console.log("PURCHASE SETTLEMENT TESTS: PASS");
  console.log("- first settlement: PASS");
  console.log("- repeated settlement is idempotent: PASS");
  console.log("- purchased credits are created exactly once: PASS");
}

main().catch((error) => {
  console.error("PURCHASE SETTLEMENT TESTS: FAIL");
  console.error(error);
  process.exitCode = 1;
});
