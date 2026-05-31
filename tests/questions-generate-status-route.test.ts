import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-user-api", () => ({
  requireUserApi: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    generationJob: {
      findFirst: vi.fn()
    },
    question: {
      groupBy: vi.fn()
    }
  }
}));

import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";
import { GET } from "@/app/api/questions/generate/status/route";

describe("generate questions status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireUserApi as any).mockResolvedValue({ id: "user-1" });
  });

  it("exposes a clean zero-saved failure state", async () => {
    (prisma.generationJob.findFirst as any).mockResolvedValue({
      id: "job-1",
      userId: "user-1",
      status: "FAILED",
      currentPhase: "No valid questions were saved",
      passedCount: 0,
      requestedCount: 2,
      errorMessage:
        "No valid questions were saved. Please try again with a smaller or more focused source.",
      startedAt: new Date("2026-05-31T08:00:00.000Z"),
      completedAt: new Date("2026-05-31T08:01:00.000Z")
    });
    (prisma.question.groupBy as any).mockResolvedValue([]);

    const response = await GET(
      new Request("http://localhost/api/questions/generate/status?jobId=job-1")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobId: "job-1",
      status: "FAILED",
      currentPhase: "No valid questions were saved",
      passedCount: 0,
      requestedCount: 2,
      failedCount: 2,
      outcome: "FAILED_NONE",
      savedTypeCounts: { MCQ: 0, TRUE_FALSE: 0, SHORT_ANSWER: 0 },
      errorMessage:
        "No valid questions were saved. Please try again with a smaller or more focused source.",
      completedAt: "2026-05-31T08:01:00.000Z"
    });
  });

  it("exposes partial success when some requested questions were saved", async () => {
    (prisma.generationJob.findFirst as any).mockResolvedValue({
      id: "job-2",
      userId: "user-1",
      status: "COMPLETED",
      currentPhase: "Generation complete",
      passedCount: 1,
      requestedCount: 5,
      errorMessage: null,
      startedAt: new Date("2026-05-31T08:00:00.000Z"),
      completedAt: new Date("2026-05-31T08:01:00.000Z")
    });
    (prisma.question.groupBy as any).mockResolvedValue([
      { type: "TRUE_FALSE", _count: { _all: 1 } }
    ]);

    const response = await GET(
      new Request("http://localhost/api/questions/generate/status?jobId=job-2")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jobId: "job-2",
      status: "COMPLETED",
      passedCount: 1,
      requestedCount: 5,
      failedCount: 4,
      outcome: "COMPLETED_PARTIAL",
      savedTypeCounts: { MCQ: 0, TRUE_FALSE: 1, SHORT_ANSWER: 0 },
      errorMessage: null
    });
  });

  it("exposes full success when every requested question was saved", async () => {
    (prisma.generationJob.findFirst as any).mockResolvedValue({
      id: "job-3",
      userId: "user-1",
      status: "COMPLETED",
      currentPhase: "Generation complete",
      passedCount: 5,
      requestedCount: 5,
      errorMessage: null,
      startedAt: new Date("2026-05-31T08:00:00.000Z"),
      completedAt: new Date("2026-05-31T08:01:00.000Z")
    });
    (prisma.question.groupBy as any).mockResolvedValue([
      { type: "MCQ", _count: { _all: 5 } }
    ]);

    const response = await GET(
      new Request("http://localhost/api/questions/generate/status?jobId=job-3")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jobId: "job-3",
      status: "COMPLETED",
      passedCount: 5,
      requestedCount: 5,
      failedCount: 0,
      outcome: "COMPLETED_FULL",
      savedTypeCounts: { MCQ: 5, TRUE_FALSE: 0, SHORT_ANSWER: 0 },
      errorMessage: null
    });
  });

  it("returns the newest non-active job state when no job is currently running", async () => {
    (prisma.generationJob.findFirst as any)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "job-newer-success",
        userId: "user-1",
        status: "COMPLETED",
        currentPhase: "Generation complete",
        passedCount: 1,
        requestedCount: 5,
        errorMessage: null,
        startedAt: new Date("2026-05-31T08:10:00.000Z"),
        completedAt: new Date("2026-05-31T08:11:00.000Z")
      });
    (prisma.question.groupBy as any).mockResolvedValue([
      { type: "TRUE_FALSE", _count: { _all: 1 } }
    ]);

    const response = await GET(
      new Request("http://localhost/api/questions/generate/status")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jobId: "job-newer-success",
      status: "COMPLETED",
      passedCount: 1,
      requestedCount: 5,
      outcome: "COMPLETED_PARTIAL",
      errorMessage: null
    });
    expect(prisma.generationJob.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { userId: "user-1" },
        orderBy: { updatedAt: "desc" }
      })
    );
  });
});
