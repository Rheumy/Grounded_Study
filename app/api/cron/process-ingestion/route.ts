import { NextResponse } from "next/server";
import { logger } from "@/lib/observability/logger";
import { processGenerationJobsBatch, processIngestionJobsBatch } from "@/lib/jobs/run-batch";

function getBatchLimit() {
  const configured = Number(process.env.CRON_INGESTION_BATCH_SIZE ?? 3);
  if (!Number.isFinite(configured)) {
    return 3;
  }
  return Math.max(1, Math.min(Math.floor(configured), 10));
}

function getGenerationBatchLimit() {
  const configured = Number(process.env.CRON_GENERATION_BATCH_SIZE ?? 1);
  if (!Number.isFinite(configured)) {
    return 1;
  }
  return Math.max(1, Math.min(Math.floor(configured), 3));
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret) {
    logger.error("CRON_SECRET is not configured");
    return NextResponse.json({ ok: false, error: "Cron secret not configured" }, { status: 500 });
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    logger.warn("Rejected cron ingestion request");
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const batchLimit = getBatchLimit();
  const generationBatchLimit = getGenerationBatchLimit();
  logger.info({ batchLimit, generationBatchLimit }, "Cron job invocation accepted");

  const batch = await processIngestionJobsBatch({
    limit: batchLimit,
    source: "cron"
  });
  const generationBatch = await processGenerationJobsBatch({
    limit: generationBatchLimit,
    source: "cron"
  });

  return NextResponse.json({
    ok: true,
    claimed: batch.claimed + generationBatch.claimed,
    completed: batch.completed + generationBatch.completed,
    failed: batch.failed + generationBatch.failed,
    results: [...batch.results, ...generationBatch.results]
  });
}
