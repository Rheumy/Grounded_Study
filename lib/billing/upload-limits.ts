import type { PlanTier } from "@prisma/client";
import { getOrCreateSubscription } from "@/lib/billing/subscription";

const DEFAULT_FREE_MAX_UPLOAD_MB = 20;
const DEFAULT_PRO_MAX_UPLOAD_MB = 100;
const DEFAULT_ABSOLUTE_MAX_UPLOAD_MB = 250;

export type ResolvedUploadCaps = {
  plan: PlanTier;
  freeMaxMb: number;
  proMaxMb: number;
  absoluteMaxMb: number;
  planMaxMb: number;
};

function readMaxUploadMb(name: string, fallback: number) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }
  return Math.round(raw);
}

export function resolveUploadCaps(plan: PlanTier): ResolvedUploadCaps {
  const freeFallback = readMaxUploadMb("MAX_UPLOAD_MB", DEFAULT_FREE_MAX_UPLOAD_MB);
  const absoluteMaxMb = Math.min(
    readMaxUploadMb("ABSOLUTE_MAX_UPLOAD_MB", DEFAULT_ABSOLUTE_MAX_UPLOAD_MB),
    DEFAULT_ABSOLUTE_MAX_UPLOAD_MB
  );
  const freeMaxMb = Math.min(
    readMaxUploadMb("FREE_MAX_UPLOAD_MB", freeFallback),
    absoluteMaxMb
  );
  const proConfigured = readMaxUploadMb("PRO_MAX_UPLOAD_MB", DEFAULT_PRO_MAX_UPLOAD_MB);
  const proMaxMb = Math.min(Math.max(proConfigured, freeMaxMb), absoluteMaxMb);

  return {
    plan,
    freeMaxMb,
    proMaxMb,
    absoluteMaxMb,
    planMaxMb: plan === "PRO" ? proMaxMb : freeMaxMb
  };
}

export async function resolveUserUploadCaps(userId: string) {
  const subscription = await getOrCreateSubscription(userId);
  return {
    subscription,
    ...resolveUploadCaps(subscription.plan)
  };
}

export function bytesToDisplayMb(sizeBytes: number) {
  return Number((sizeBytes / (1024 * 1024)).toFixed(1));
}

export function isSplitCandidate(params: {
  kind: "pdf" | "image" | "text" | "docx";
  sizeBytes: number;
  planMaxMb: number;
  absoluteMaxMb: number;
}) {
  const planMaxBytes = params.planMaxMb * 1024 * 1024;
  const absoluteMaxBytes = params.absoluteMaxMb * 1024 * 1024;

  return (
    params.kind === "pdf" &&
    params.sizeBytes > planMaxBytes &&
    params.sizeBytes <= absoluteMaxBytes
  );
}
