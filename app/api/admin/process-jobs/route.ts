import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/options";
import { logger } from "@/lib/observability/logger";
import { processGenerationJobsBatch, processIngestionJobsBatch } from "@/lib/jobs/run-batch";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const token = process.env.ADMIN_JOB_TOKEN;
  const authHeader = request.headers.get("authorization");
  const tokenOk = token && authHeader === `Bearer ${token}`;
  if (!session?.user?.isAdmin && !tokenOk) {
    logger.warn("Rejected job processing request");
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ingestionBatch = await processIngestionJobsBatch({ limit: 1, source: "admin" });
  const generationBatch =
    ingestionBatch.claimed === 0
      ? await processGenerationJobsBatch({ limit: 1, source: "admin" })
      : { claimed: 0, results: [] };
  const claimed = ingestionBatch.claimed + generationBatch.claimed;

  if (claimed === 0) {
    logger.info("Manual admin job processing found no queued jobs");
    return NextResponse.json({ ok: true, message: "No jobs" });
  }

  const failedJob = [...ingestionBatch.results, ...generationBatch.results].find(
    (result) => result.status === "failed"
  );
  if (failedJob) {
    return NextResponse.json(
      { ok: false, jobId: failedJob.jobId, error: failedJob.error ?? "Unknown error" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    jobId: ingestionBatch.results[0]?.jobId ?? generationBatch.results[0]?.jobId
  });
}
