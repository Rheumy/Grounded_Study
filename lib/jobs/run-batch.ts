import {
  claimNextGenerationJob,
  claimNextIngestionJob,
  markJobCompleted,
  markJobFailed,
  reapStuckGenerationJobs
} from "@/lib/jobs/queue";
import {
  processGenerationJob,
  processIngestionJob,
  type GenerationProcessingSource
} from "@/lib/jobs/processor";
import { logger } from "@/lib/observability/logger";

export type IngestionBatchSource = "cron" | "admin";

export async function processIngestionJobsBatch(params: {
  limit: number;
  source: IngestionBatchSource;
}) {
  const limit = Math.max(1, Math.min(params.limit, 10));
  const results: Array<{ jobId: string; documentId: string; status: "completed" | "failed"; error?: string }> = [];

  logger.info({ source: params.source, limit }, "Ingestion batch invocation started");

  for (let index = 0; index < limit; index += 1) {
    const job = await claimNextIngestionJob();
    if (!job) {
      break;
    }

    logger.info(
      { source: params.source, jobId: job.id, documentId: job.documentId, position: index + 1 },
      "Ingestion batch processing claimed job"
    );

    try {
      await processIngestionJob(job.id);
      await markJobCompleted(job.id);
      results.push({ jobId: job.id, documentId: job.documentId, status: "completed" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await markJobFailed(job.id, message);
      results.push({ jobId: job.id, documentId: job.documentId, status: "failed", error: message });
    }
  }

  const completed = results.filter((result) => result.status === "completed").length;
  const failed = results.length - completed;

  logger.info(
    { source: params.source, claimed: results.length, completed, failed },
    "Ingestion batch invocation finished"
  );

  return {
    claimed: results.length,
    completed,
    failed,
    results
  };
}

export async function processGenerationJobsBatch(params: {
  limit: number;
  source: Exclude<GenerationProcessingSource, "immediate">;
}) {
  const limit = Math.max(1, Math.min(params.limit, 5));
  const results: Array<{ jobId: string; status: "completed" | "failed"; error?: string }> = [];

  logger.info({ source: params.source, limit }, "Generation batch invocation started");
  const reaped = await reapStuckGenerationJobs();

  for (let index = 0; index < limit; index += 1) {
    const job = await claimNextGenerationJob();
    if (!job) {
      break;
    }

    logger.info(
      { source: params.source, jobId: job.id, userId: job.userId, position: index + 1 },
      "Generation batch processing claimed job"
    );

    try {
      await processGenerationJob(job.id, { processingSource: params.source });
      results.push({ jobId: job.id, status: "completed" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      results.push({ jobId: job.id, status: "failed", error: message });
    }
  }

  const completed = results.filter((result) => result.status === "completed").length;
  const failed = results.length - completed;

  logger.info(
    { source: params.source, claimed: results.length, completed, failed, reaped },
    "Generation batch invocation finished"
  );

  return {
    claimed: results.length,
    completed,
    failed,
    reaped,
    results
  };
}
