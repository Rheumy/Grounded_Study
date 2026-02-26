import { prisma } from "@/lib/db/prisma";

export async function getOrCreateSubscription(userId: string) {
  let subscription = await prisma.subscription.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" }
  });

  if (!subscription) {
    subscription = await prisma.subscription.create({
      data: { userId, plan: "FREE", status: "ACTIVE" }
    });
  }

  return subscription;
}
