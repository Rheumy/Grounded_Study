export type PlanLimits = {
  uploadsPerDay: number;
  questionsPerDay: number;
  storageMb: number;
};

export const PLAN_LIMITS: Record<"FREE" | "PRO", PlanLimits> = {
  FREE: { uploadsPerDay: 5, questionsPerDay: 20, storageMb: 200 },
  PRO: { uploadsPerDay: 50, questionsPerDay: 200, storageMb: 2000 }
};
