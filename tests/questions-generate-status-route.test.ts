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
      savedTypeCounts: { MCQ: 0, TRUE_FALSE: 0, SHORT_ANSWER: 0 },
      errorMessage:
        "No valid questions were saved. Please try again with a smaller or more focused source.",
      completedAt: "2026-05-31T08:01:00.000Z"
    });
  });
});
