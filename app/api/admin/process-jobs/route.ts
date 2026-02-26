import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { claimNextIngestionJob, markJobCompleted, markJobFailed } from "@/lib/jobs/queue";
import { processIngestionJob } from "@/lib/jobs/processor";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const token = process.env.ADMIN_JOB_TOKEN;
  const authHeader = request.headers.get("authorization");
  const tokenOk = token && authHeader === `Bearer ${token}`;
  if (!session?.user?.isAdmin && !tokenOk) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const job = await claimNextIngestionJob();
  if (!job) {
    return NextResponse.json({ ok: true, message: "No jobs" });
  }

  try {
    await processIngestionJob(job.id);
    await markJobCompleted(job.id);
    return NextResponse.json({ ok: true, jobId: job.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await markJobFailed(job.id, message);
    return NextResponse.json({ ok: false, jobId: job.id, error: message }, { status: 500 });
  }
}
