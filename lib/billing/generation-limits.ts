import type { PlanTier } from "@prisma/client";
import { getOrCreateSubscription } from "@/lib/billing/subscription";

const DEFAULT_FREE_MAX_GENERATE_COUNT = 25;
const DEFAULT_PRO_MAX_GENERATE_COUNT = 100;
const DEFAULT_ABSOLUTE_MAX_GENERATE_COUNT = 100;

export type ResolvedGenerationCaps = {
  plan: PlanTier;
  freeMaxCount: number;
  proMaxCount: number;
  absoluteMaxCount: number;
  planMaxCount: number;
};

function readMaxGenerateCount(name: string, fallback: number) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }

  return Math.round(raw);
}

export function resolveGenerationCaps(plan: PlanTier): ResolvedGenerationCaps {
  const absoluteMaxCount = Math.min(
    readMaxGenerateCount("ABSOLUTE_MAX_GENERATE_COUNT", DEFAULT_ABSOLUTE_MAX_GENERATE_COUNT),
    DEFAULT_ABSOLUTE_MAX_GENERATE_COUNT
  );
  const freeMaxCount = Math.min(
    readMaxGenerateCount("FREE_MAX_GENERATE_COUNT", DEFAULT_FREE_MAX_GENERATE_COUNT),
    absoluteMaxCount
  );
  const proConfigured = readMaxGenerateCount(
    "PRO_MAX_GENERATE_COUNT",
    DEFAULT_PRO_MAX_GENERATE_COUNT
  );
  const proMaxCount = Math.min(Math.max(proConfigured, freeMaxCount), absoluteMaxCount);

  return {
    plan,
    freeMaxCount,
    proMaxCount,
    absoluteMaxCount,
    planMaxCount: plan === "PRO" ? proMaxCount : freeMaxCount
  };
}

export async function resolveUserGenerationCaps(userId: string) {
  const subscription = await getOrCreateSubscription(userId);
  return {
    subscription,
    ...resolveGenerationCaps(subscription.plan)
  };
}
