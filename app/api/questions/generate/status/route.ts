import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";
import { sanitizeGenerationErrorMessage } from "@/lib/jobs/errors";
import {
  getGenerationFailedCount,
  getGenerationOutcome
} from "@/lib/generation/job-outcome";

function serializeJob(job: {
  id: string;
  userId: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  currentPhase: string | null;
  passedCount: number;
  requestedCount: number;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  savedTypeCounts?: { MCQ: number; TRUE_FALSE: number; SHORT_ANSWER: number };
}) {
  return {
    jobId: job.id,
    status: job.status,
    currentPhase: job.currentPhase,
    passedCount: job.passedCount,
    requestedCount: job.requestedCount,
    failedCount: getGenerationFailedCount(job),
    outcome: getGenerationOutcome(job),
    savedTypeCounts: job.savedTypeCounts ?? { MCQ: 0, TRUE_FALSE: 0, SHORT_ANSWER: 0 },
    errorMessage: job.errorMessage ? sanitizeGenerationErrorMessage(job.errorMessage) : null,
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
    userId: true,
    status: true,
    currentPhase: true,
    passedCount: true,
    requestedCount: true,
    errorMessage: true,
    startedAt: true,
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

  const savedTypeCounts = {
    MCQ: 0,
    TRUE_FALSE: 0,
    SHORT_ANSWER: 0
  };
  if (job.startedAt && job.completedAt) {
    const rows = await prisma.question.groupBy({
      by: ["type"],
      where: {
        ownerId: user.id,
        verifierStatus: "PASSED",
        createdAt: {
          gte: job.startedAt,
          lte: job.completedAt
        }
      },
      _count: {
        _all: true
      }
    });

    for (const row of rows) {
      savedTypeCounts[row.type] = row._count._all;
    }
  }

  return NextResponse.json(serializeJob({ ...job, savedTypeCounts }));
}
