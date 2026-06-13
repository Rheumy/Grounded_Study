import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    generationJob: {
      findFirst: vi.fn(),
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
import {
  claimGenerationJobForUser,
  claimNextGenerationJob,
  reapStuckGenerationJobs
} from "@/lib/jobs/queue";
import { processGenerationJobsBatch } from "@/lib/jobs/run-batch";

describe("generation job queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("reaps stale processing generation jobs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T12:00:00.000Z"));
    (prisma.generationJob.updateMany as any)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 2 });

    const reaped = await reapStuckGenerationJobs();

    expect(reaped).toBe(3);
    expect(prisma.generationJob.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        status: "PROCESSING",
        startedAt: { lt: new Date("2026-05-03T11:50:00.000Z") },
        passedCount: { gt: 0 }
      },
      data: {
        status: "COMPLETED",
        currentPhase: "Generation complete with partial results",
        errorMessage: null,
        completedAt: new Date("2026-05-03T12:00:00.000Z")
      }
    });
    expect(prisma.generationJob.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        status: "PROCESSING",
        startedAt: { lt: new Date("2026-05-03T11:50:00.000Z") },
        passedCount: 0
      },
      data: {
        status: "FAILED",
        currentPhase: "Generation timed out",
        errorMessage:
          "We couldn't generate supported questions from this material. Try a different document or fewer questions.",
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

  it("lets the correct user claim their pending generation job by ID", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T12:00:00.000Z"));
    const claimedJob = {
      id: "job-1",
      userId: "user-1",
      status: "PROCESSING"
    };
    (prisma.generationJob.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.generationJob.findFirst as any).mockResolvedValue(claimedJob);

    const claimed = await claimGenerationJobForUser({ jobId: "job-1", userId: "user-1" });

    expect(claimed).toEqual(claimedJob);
    expect(prisma.generationJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: "job-1",
        userId: "user-1",
        status: "PENDING",
        OR: [
          { currentPhase: null },
          { currentPhase: { not: "Waiting for scheduled retry" } }
        ]
      },
      data: {
        status: "PROCESSING",
        startedAt: new Date("2026-05-03T12:00:00.000Z"),
        currentPhase: "Starting generation",
        errorMessage: null
      }
    });
  });

  it("does not let another user claim a generation job", async () => {
    (prisma.generationJob.updateMany as any).mockResolvedValue({ count: 0 });

    const claimed = await claimGenerationJobForUser({ jobId: "job-1", userId: "user-2" });

    expect(claimed).toBeNull();
    expect(prisma.generationJob.findFirst).not.toHaveBeenCalled();
  });

  it("allows only one of two competing generation job claims to succeed", async () => {
    (prisma.generationJob.updateMany as any)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    (prisma.generationJob.findFirst as any).mockResolvedValue({
      id: "job-1",
      userId: "user-1",
      status: "PROCESSING"
    });

    const first = await claimGenerationJobForUser({ jobId: "job-1", userId: "user-1" });
    const second = await claimGenerationJobForUser({ jobId: "job-1", userId: "user-1" });

    expect(first).toMatchObject({ id: "job-1", status: "PROCESSING" });
    expect(second).toBeNull();
    expect(prisma.generationJob.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.generationJob.findFirst).toHaveBeenCalledTimes(1);
  });

  it("does not claim an already processing or completed generation job", async () => {
    (prisma.generationJob.updateMany as any).mockResolvedValue({ count: 0 });

    const claimed = await claimGenerationJobForUser({ jobId: "job-1", userId: "user-1" });

    expect(claimed).toBeNull();
    expect(prisma.generationJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "job-1", userId: "user-1", status: "PENDING" })
      })
    );
    expect(prisma.generationJob.findFirst).not.toHaveBeenCalled();
  });

  it("does not immediately reclaim a job already requeued for scheduled retry", async () => {
    (prisma.generationJob.updateMany as any).mockResolvedValue({ count: 0 });

    const claimed = await claimGenerationJobForUser({ jobId: "job-1", userId: "user-1" });

    expect(claimed).toBeNull();
    expect(prisma.generationJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "job-1",
          userId: "user-1",
          status: "PENDING",
          OR: [
            { currentPhase: null },
            { currentPhase: { not: "Waiting for scheduled retry" } }
          ]
        })
      })
    );
  });

  it("reaps stale jobs before claiming and reports them separately", async () => {
    (prisma.generationJob.updateMany as any)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
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
    expect(prisma.generationJob.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ status: "PROCESSING", passedCount: { gt: 0 } }),
        data: expect.objectContaining({
          status: "COMPLETED",
          currentPhase: "Generation complete with partial results",
          errorMessage: null,
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
