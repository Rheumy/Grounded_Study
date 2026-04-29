import {
  claimNextGenerationJob,
  claimNextIngestionJob,
  markJobCompleted,
  markJobFailed
} from "@/lib/jobs/queue";
import { processGenerationJob, processIngestionJob } from "@/lib/jobs/processor";
import { logger } from "@/lib/observability/logger";

const POLL_INTERVAL_MS = 3000;
let shouldRun = true;

process.on("SIGINT", () => {
  shouldRun = false;
});

process.on("SIGTERM", () => {
  shouldRun = false;
});

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  logger.info("Worker started");

  while (shouldRun) {
    const job = await claimNextIngestionJob();
    if (job) {
      logger.info({ jobId: job.id }, "Processing ingestion job");
      try {
        await processIngestionJob(job.id);
        await markJobCompleted(job.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        logger.error({ jobId: job.id, message }, "Ingestion job failed");
        await markJobFailed(job.id, message);
      }
      continue;
    }

    const generationJob = await claimNextGenerationJob();
    if (!generationJob) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    logger.info({ jobId: generationJob.id }, "Processing generation job");
    try {
      await processGenerationJob(generationJob.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error({ jobId: generationJob.id, message }, "Generation job failed");
    }
  }

  logger.info("Worker stopped");
}

main().catch((error) => {
  logger.error({ error }, "Worker crashed");
  process.exit(1);
});
