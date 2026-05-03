import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    generationJob: {
      update: vi.fn(),
      updateMany: vi.fn()
    }
  }
}));

vi.mock("@/lib/jobs/processor", () => ({
  processGenerationJob: vi.fn()
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

import { prisma } from "@/lib/db/prisma";
import { sanitizeGenerationErrorMessage } from "@/lib/jobs/errors";
import { claimNextGenerationJob, reapStuckGenerationJobs } from "@/lib/jobs/queue";
import { processGenerationJobsBatch } from "@/lib/jobs/run-batch";

describe("generation job queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("reaps stale processing generation jobs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T12:00:00.000Z"));
    (prisma.generationJob.updateMany as any).mockResolvedValue({ count: 1 });

    const reaped = await reapStuckGenerationJobs();

    expect(reaped).toBe(1);
    expect(prisma.generationJob.updateMany).toHaveBeenCalledWith({
      where: {
        status: "PROCESSING",
        startedAt: { lt: new Date("2026-05-03T11:50:00.000Z") }
      },
      data: {
        status: "FAILED",
        currentPhase: "Generation timed out",
        errorMessage: "Generation timed out. Please try again.",
        completedAt: new Date("2026-05-03T12:00:00.000Z")
      }
    });
  });

  it("claims pending jobs with a fresh startedAt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T12:00:00.000Z"));
    const staleStartedAt = new Date("2026-05-03T11:00:00.000Z");
    const pendingJob = {
      id: "job-1",
      userId: "user-1",
      documentIds: ["doc-1"],
      typeMix: { MCQ: 1, SHORT_ANSWER: 0, TRUE_FALSE: 0 },
      styleProfileId: null,
      presetKey: null,
      difficulty: 3,
      requestedCount: 1,
      status: "PENDING",
      passedCount: 0,
      currentPhase: "Waiting to start",
      startedAt: staleStartedAt,
      completedAt: null,
      errorMessage: "old error",
      createdAt: staleStartedAt,
      updatedAt: staleStartedAt
    };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([pendingJob]),
      generationJob: {
        update: vi.fn().mockResolvedValue({ ...pendingJob, status: "PROCESSING" })
      }
    };
    (prisma.$transaction as any).mockImplementation((callback: (txArg: unknown) => unknown) => callback(tx));

    const claimed = await claimNextGenerationJob();

    expect(claimed).toEqual(pendingJob);
    expect(tx.generationJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        status: "PROCESSING",
        startedAt: new Date("2026-05-03T12:00:00.000Z"),
        currentPhase: "Starting generation",
        errorMessage: null
      }
    });
  });

  it("reaps stale jobs before claiming and reports them separately", async () => {
    (prisma.generationJob.updateMany as any).mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      generationJob: {
        update: vi.fn()
      }
    };
    (prisma.$transaction as any).mockImplementation((callback: (txArg: unknown) => unknown) => callback(tx));

    const batch = await processGenerationJobsBatch({ limit: 1, source: "cron" });

    expect(batch.reaped).toBe(1);
    expect(batch.claimed).toBe(0);
    expect(batch.completed).toBe(0);
    expect(batch.failed).toBe(0);
    expect(prisma.generationJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PROCESSING" }),
        data: expect.objectContaining({
          status: "FAILED",
          currentPhase: "Generation timed out",
          errorMessage: "Generation timed out. Please try again.",
          completedAt: expect.any(Date)
        })
      })
    );
  });
});

describe("generation job errors", () => {
  it("hides raw schema dumps from stored user-facing errors", () => {
    const message = sanitizeGenerationErrorMessage(
      new Error('[\n  { "code": "invalid_type", "path": ["answer"], "message": "Required" }\n]')
    );

    expect(message).toBe("Generation failed. Please try again.");
  });
});
