import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    generationJob: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn()
    }
  }
}));

vi.mock("@/lib/storage/storage", () => ({
  readFile: vi.fn()
}));

vi.mock("@/lib/ingestion/ingest", () => ({
  ingestDocument: vi.fn()
}));

vi.mock("@/lib/billing/usage", () => ({
  incrementUsage: vi.fn()
}));

vi.mock("@/lib/llm/generate", () => ({
  generateQuestions: vi.fn()
}));

vi.mock("@/lib/llm/presets", () => ({
  resolvePreset: vi.fn(() => null)
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

import { prisma } from "@/lib/db/prisma";
import { incrementUsage } from "@/lib/billing/usage";
import { generateQuestions } from "@/lib/llm/generate";
import { processGenerationJob } from "@/lib/jobs/processor";

const generationJob = {
  id: "job-1",
  userId: "user-1",
  documentIds: ["doc-1"],
  typeMix: { MCQ: 0, SHORT_ANSWER: 0, TRUE_FALSE: 2 },
  styleProfileId: null,
  presetKey: null,
  difficulty: 3,
  requestedCount: 2,
  status: "PENDING",
  passedCount: 0,
  currentPhase: "Waiting to start",
  startedAt: null,
  completedAt: null,
  errorMessage: null,
  createdAt: new Date("2026-05-03T11:59:00.000Z"),
  updatedAt: new Date("2026-05-03T11:59:00.000Z")
};

describe("generation job processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.generationJob.findUnique as any).mockResolvedValue(generationJob);
    (prisma.generationJob.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.generationJob.update as any).mockResolvedValue({});
  });

  it("marks a zero-saved generation job as failed with a clean message", async () => {
    (generateQuestions as any).mockResolvedValue([
      { status: "INSUFFICIENT_EVIDENCE", reason: "Verifier rejected true/false item" },
      { status: "INSUFFICIENT_EVIDENCE", reason: "Generated MCQ when TRUE_FALSE was requested" }
    ]);

    await processGenerationJob("job-1");

    expect(incrementUsage).not.toHaveBeenCalled();
    expect(prisma.generationJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: "FAILED",
        passedCount: 0,
        currentPhase: "No valid questions were saved",
        errorMessage:
          "No valid questions were saved. Please try again with a smaller or more focused source.",
        completedAt: expect.any(Date)
      })
    });
  });

  it("marks a partially saved generation job as completed with partial progress", async () => {
    (prisma.generationJob.findUnique as any).mockResolvedValue({
      ...generationJob,
      requestedCount: 5
    });
    (generateQuestions as any).mockResolvedValue([
      { questionId: "question-1", status: "PASSED" },
      { status: "INSUFFICIENT_EVIDENCE", reason: "Verifier rejected true/false item" },
      { status: "INSUFFICIENT_EVIDENCE", reason: "Verifier rejected true/false item" },
      { status: "INSUFFICIENT_EVIDENCE", reason: "Verifier rejected true/false item" },
      { status: "INSUFFICIENT_EVIDENCE", reason: "Verifier rejected true/false item" }
    ]);

    await processGenerationJob("job-1");

    expect(incrementUsage).toHaveBeenCalledWith({ userId: "user-1", questions: 1 });
    expect(prisma.generationJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: "COMPLETED",
        passedCount: 1,
        currentPhase: "Generation complete: 1 of 5 saved",
        errorMessage: null,
        completedAt: expect.any(Date)
      })
    });
  });

  it("requeues an immediate processing failure so cron can retry", async () => {
    (prisma.generationJob.findUnique as any).mockResolvedValue({
      ...generationJob,
      status: "PROCESSING",
      startedAt: new Date("2026-05-03T12:00:00.000Z")
    });
    (generateQuestions as any).mockRejectedValue(new Error("Temporary model outage"));

    await expect(
      processGenerationJob("job-1", { processingSource: "immediate" })
    ).rejects.toThrow("Temporary model outage");

    expect(prisma.generationJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: "job-1",
        status: "FAILED",
        passedCount: 0
      },
      data: {
        status: "PENDING",
        currentPhase: "Waiting for scheduled retry",
        startedAt: null,
        completedAt: null,
        errorMessage: null
      }
    });
  });
});
