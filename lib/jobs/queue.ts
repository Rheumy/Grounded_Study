import { prisma } from "@/lib/db/prisma";
import type { IngestionJob } from "@prisma/client";

const LOCK_TIMEOUT_MS = 1000 * 60 * 10;

export async function claimNextIngestionJob(): Promise<IngestionJob | null> {
  const now = new Date();
  const lockExpiry = new Date(Date.now() - LOCK_TIMEOUT_MS);

  return prisma.$transaction(async (tx) => {
    const jobs = await tx.$queryRaw<IngestionJob[]>`
      SELECT * FROM "IngestionJob"
      WHERE ("status" = 'QUEUED' OR ("status" = 'RUNNING' AND "lockedAt" < ${lockExpiry}))
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;

    if (!jobs.length) return null;

    const job = jobs[0];
    await tx.ingestionJob.update({
      where: { id: job.id },
      data: {
        status: "RUNNING",
        lockedAt: now,
        attempts: { increment: 1 }
      }
    });

    return job;
  });
}

export async function markJobCompleted(jobId: string) {
  return prisma.ingestionJob.update({
    where: { id: jobId },
    data: { status: "COMPLETED", lockedAt: null }
  });
}

export async function markJobFailed(jobId: string, error: string) {
  return prisma.ingestionJob.update({
    where: { id: jobId },
    data: { status: "FAILED", lastError: error, lockedAt: null }
  });
}
