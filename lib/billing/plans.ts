import type { PlanTier } from "@prisma/client";

export type PlanLimits = {
  uploadsPerDay: number;
  questionsPerDay: number;
  storageMb: number;
};

const DEFAULT_FREE_LIMITS: PlanLimits = {
  uploadsPerDay: 5,
  questionsPerDay: 25,
  storageMb: 200
};

const DEFAULT_PRO_LIMITS: PlanLimits = {
  uploadsPerDay: 50,
  questionsPerDay: 200,
  storageMb: 2000
};

function readPlanLimit(name: string, fallback: number) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }

  return Math.round(raw);
}

export function resolvePlanLimits(plan: PlanTier): PlanLimits {
  const freeLimits: PlanLimits = {
    uploadsPerDay: readPlanLimit("FREE_UPLOADS_PER_DAY", DEFAULT_FREE_LIMITS.uploadsPerDay),
    questionsPerDay: readPlanLimit("FREE_QUESTIONS_PER_DAY", DEFAULT_FREE_LIMITS.questionsPerDay),
    storageMb: readPlanLimit("FREE_STORAGE_MB", DEFAULT_FREE_LIMITS.storageMb)
  };

  const proLimits: PlanLimits = {
    uploadsPerDay: Math.max(
      readPlanLimit("PRO_UPLOADS_PER_DAY", DEFAULT_PRO_LIMITS.uploadsPerDay),
      freeLimits.uploadsPerDay
    ),
    questionsPerDay: Math.max(
      readPlanLimit("PRO_QUESTIONS_PER_DAY", DEFAULT_PRO_LIMITS.questionsPerDay),
      freeLimits.questionsPerDay
    ),
    storageMb: Math.max(
      readPlanLimit("PRO_STORAGE_MB", DEFAULT_PRO_LIMITS.storageMb),
      freeLimits.storageMb
    )
  };

  return plan === "PRO" ? proLimits : freeLimits;
}
