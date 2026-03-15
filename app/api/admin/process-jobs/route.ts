import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/options";
import { claimNextIngestionJob, markJobCompleted, markJobFailed } from "@/lib/jobs/queue";
import { processIngestionJob } from "@/lib/jobs/processor";
import { logger } from "@/lib/observability/logger";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const token = process.env.ADMIN_JOB_TOKEN;
  const authHeader = request.headers.get("authorization");
  const tokenOk = token && authHeader === `Bearer ${token}`;
  if (!session?.user?.isAdmin && !tokenOk) {
    logger.warn("Rejected job processing request");
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const job = await claimNextIngestionJob();
  if (!job) {
    logger.info("Job processing requested but no queued jobs were available");
    return NextResponse.json({ ok: true, message: "No jobs" });
  }

  logger.info({ jobId: job.id, documentId: job.documentId }, "Admin job processing started");

  try {
    await processIngestionJob(job.id);
    await markJobCompleted(job.id);
    logger.info({ jobId: job.id, documentId: job.documentId }, "Admin job processing completed");
    return NextResponse.json({ ok: true, jobId: job.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await markJobFailed(job.id, message);
    logger.error({ jobId: job.id, documentId: job.documentId, message }, "Admin job processing failed");
    return NextResponse.json({ ok: false, jobId: job.id, error: message }, { status: 500 });
  }
}
