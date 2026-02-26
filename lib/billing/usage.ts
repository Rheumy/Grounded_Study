import { prisma } from "@/lib/db/prisma";
import { PLAN_LIMITS } from "@/lib/billing/plans";
import { getOrCreateSubscription } from "@/lib/billing/subscription";

function startOfDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function checkUsage(userId: string) {
  const subscription = await getOrCreateSubscription(userId);
  const limits = PLAN_LIMITS[subscription.plan];
  const day = startOfDay();
  const counter = await prisma.usageCounter.findUnique({
    where: { userId_day: { userId, day } }
  });

  return { subscription, limits, counter };
}

export async function enforceUploadLimit(userId: string, sizeBytes: number) {
  const { limits, counter } = await checkUsage(userId);
  const uploads = counter?.uploads ?? 0;
  const storageBytes = Number(counter?.storageBytes ?? 0n);

  if (uploads + 1 > limits.uploadsPerDay) {
    throw new Error(`Upload limit reached (${limits.uploadsPerDay}/day).`);
  }

  const maxStorageBytes = limits.storageMb * 1024 * 1024;
  if (storageBytes + sizeBytes > maxStorageBytes) {
    throw new Error(`Storage limit reached (${limits.storageMb}MB).`);
  }

  return limits;
}

export async function enforceQuestionLimit(userId: string, count: number) {
  const { limits, counter } = await checkUsage(userId);
  const questions = counter?.questions ?? 0;
  if (questions + count > limits.questionsPerDay) {
    throw new Error(`Question limit reached (${limits.questionsPerDay}/day).`);
  }
  return limits;
}

export async function incrementUsage(params: {
  userId: string;
  uploads?: number;
  questions?: number;
  storageBytes?: number;
}) {
  const day = startOfDay();
  return prisma.usageCounter.upsert({
    where: { userId_day: { userId: params.userId, day } },
    create: {
      userId: params.userId,
      day,
      uploads: params.uploads ?? 0,
      questions: params.questions ?? 0,
      storageBytes: BigInt(params.storageBytes ?? 0)
    },
    update: {
      uploads: { increment: params.uploads ?? 0 },
      questions: { increment: params.questions ?? 0 },
      storageBytes: { increment: BigInt(params.storageBytes ?? 0) }
    }
  });
}
