import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { claimGenerationJobForUser } from "@/lib/jobs/queue";
import { processGenerationJob } from "@/lib/jobs/processor";
import { logger } from "@/lib/observability/logger";

export async function POST(request: Request) {
  const user = await requireUserApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  if (!jobId) {
    return NextResponse.json({ error: "Missing generation job ID" }, { status: 400 });
  }

  const job = await claimGenerationJobForUser({ jobId, userId: user.id });
  if (!job) {
    return NextResponse.json({ ok: true, claimed: false }, { status: 202 });
  }

  try {
    await processGenerationJob(job.id, { processingSource: "immediate" });
    return NextResponse.json({ ok: true, claimed: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.warn(
      { jobId: job.id, userId: user.id, processingSource: "immediate", message },
      "Immediate generation processing failed"
    );
    return NextResponse.json({ ok: false, claimed: true }, { status: 202 });
  }
}
