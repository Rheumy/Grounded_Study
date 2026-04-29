import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";

function serializeJob(job: {
  id: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  currentPhase: string | null;
  passedCount: number;
  requestedCount: number;
  errorMessage: string | null;
  completedAt: Date | null;
}) {
  return {
    jobId: job.id,
    status: job.status,
    currentPhase: job.currentPhase,
    passedCount: job.passedCount,
    requestedCount: job.requestedCount,
    errorMessage: job.errorMessage,
    completedAt: job.completedAt?.toISOString() ?? null
  };
}

export async function GET(request: Request) {
  const user = await requireUserApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");

  const select = {
    id: true,
    status: true,
    currentPhase: true,
    passedCount: true,
    requestedCount: true,
    errorMessage: true,
    completedAt: true
  } as const;

  const job = jobId
    ? await prisma.generationJob.findFirst({
        where: { id: jobId, userId: user.id },
        select
      })
    : (await prisma.generationJob.findFirst({
        where: { userId: user.id, status: { in: ["PENDING", "PROCESSING"] } },
        orderBy: { updatedAt: "desc" },
        select
      })) ??
      (await prisma.generationJob.findFirst({
        where: { userId: user.id },
        orderBy: { updatedAt: "desc" },
        select
      }));

  if (!job) {
    return NextResponse.json({ job: null }, { status: jobId ? 404 : 200 });
  }

  return NextResponse.json(serializeJob(job));
}
