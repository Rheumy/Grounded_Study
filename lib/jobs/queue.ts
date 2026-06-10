import { prisma } from "@/lib/db/prisma";
import type { GenerationJob, IngestionJob } from "@prisma/client";
import { logger } from "@/lib/observability/logger";

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

    logger.info(
      {
        jobId: job.id,
        documentId: job.documentId,
        previousStatus: job.status,
        attempts: job.attempts + 1
      },
      "Ingestion job claimed"
    );

    return job;
  });
}

export async function markJobCompleted(jobId: string) {
  const job = await prisma.ingestionJob.update({
    where: { id: jobId },
    data: { status: "COMPLETED", lockedAt: null }
  });
  logger.info({ jobId, documentId: job.documentId }, "Ingestion job marked complete");
  return job;
}

export async function markJobFailed(jobId: string, error: string) {
  const job = await prisma.ingestionJob.update({
    where: { id: jobId },
    data: { status: "FAILED", lastError: error, lockedAt: null }
  });
  logger.error({ jobId, documentId: job.documentId, error }, "Ingestion job marked failed");
  return job;
}

export async function claimNextGenerationJob(): Promise<GenerationJob | null> {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const jobs = await tx.$queryRaw<GenerationJob[]>`
      SELECT * FROM "GenerationJob"
      WHERE "status" = 'PENDING'
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;

    if (!jobs.length) return null;

    const job = jobs[0];
    await tx.generationJob.update({
      where: { id: job.id },
      data: {
        status: "PROCESSING",
        startedAt: now,
        currentPhase: "Starting generation",
        errorMessage: null
      }
    });

    logger.info(
      {
        jobId: job.id,
        userId: job.userId,
        requestedCount: job.requestedCount
      },
      "Generation job claimed"
    );
    logger.info({ jobId: job.id, status: "PROCESSING" }, "Job transitioned to status PROCESSING");

    return job;
  });
}

export async function reapStuckGenerationJobs(): Promise<number> {
  const lockExpiry = new Date(Date.now() - LOCK_TIMEOUT_MS);
  const completedAt = new Date();

  const partialResult = await prisma.generationJob.updateMany({
    where: {
      status: "PROCESSING",
      startedAt: { lt: lockExpiry },
      passedCount: { gt: 0 }
    },
    data: {
      status: "COMPLETED",
      currentPhase: "Generation complete with partial results",
      errorMessage: null,
      completedAt
    }
  });

  const failedResult = await prisma.generationJob.updateMany({
    where: {
      status: "PROCESSING",
      startedAt: { lt: lockExpiry },
      passedCount: 0
    },
    data: {
      status: "FAILED",
      currentPhase: "Generation timed out",
      errorMessage:
        "We couldn't generate supported questions from this material. Try a different document or fewer questions.",
      completedAt
    }
  });
  const count = partialResult.count + failedResult.count;

  if (count > 0) {
    logger.warn(
      { reapedCount: count, completedPartial: partialResult.count, failed: failedResult.count },
      "Reaped stuck generation jobs"
    );
  }

  return count;
}
