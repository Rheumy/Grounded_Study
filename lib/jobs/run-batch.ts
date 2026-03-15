import { claimNextIngestionJob, markJobCompleted, markJobFailed } from "@/lib/jobs/queue";
import { processIngestionJob } from "@/lib/jobs/processor";
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
