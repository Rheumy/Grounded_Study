import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-user-api", () => ({
  requireUserApi: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    question: {
      findMany: vi.fn()
    },
    $transaction: vi.fn()
  }
}));

vi.mock("@/lib/questions/exposure", () => ({
  buildFeedbackExcludedQuestionFilter: vi.fn(() => ({})),
  buildHiddenQuestionFilter: vi.fn(() => ({})),
  buildUnseenQuestionFilter: vi.fn(() => ({})),
  markQuestionsServed: vi.fn()
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";
import { POST } from "@/app/api/exam/start/route";

describe("exam start route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireUserApi as any).mockResolvedValue({ id: "user-1" });
    (prisma.$transaction as any).mockImplementation(async (callback: any) =>
      callback({
        examSession: {
          create: vi.fn().mockResolvedValue({ id: "session-1" })
        },
        examSessionQuestion: {
          createMany: vi.fn().mockResolvedValue({ count: 1 })
        }
      })
    );
  });

  it("starts a TRUE_FALSE-only mock exam when true/false questions are available", async () => {
    (prisma.question.findMany as any).mockResolvedValue([
      {
        id: "question-1",
        stem: "The statement is supported.",
        type: "TRUE_FALSE",
        optionsJson: ["True", "False"]
      }
    ]);

    const response = await POST(
      new Request("http://localhost/api/exam/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count: 1,
          timeLimitMin: 30,
          difficulty: 3,
          questionMix: "TRUE_FALSE"
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sessionId: "session-1",
      questions: [
        {
          id: "question-1",
          type: "TRUE_FALSE",
          options: ["True", "False"]
        }
      ]
    });
    expect(prisma.question.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              type: "TRUE_FALSE"
            })
          ])
        })
      })
    );
  });

  it("returns a clean error for an unknown mock exam question mix", async () => {
    const response = await POST(
      new Request("http://localhost/api/exam/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count: 1,
          timeLimitMin: 30,
          difficulty: 3,
          questionMix: "ESSAY"
        })
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Choose Multiple choice, True/false, or Mixed before starting a mock exam."
    });
    expect(prisma.question.findMany).not.toHaveBeenCalled();
  });

  it("keeps SHORT_ANSWER blocked during beta", async () => {
    const response = await POST(
      new Request("http://localhost/api/exam/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count: 1,
          timeLimitMin: 30,
          difficulty: 3,
          questionMix: "SHORT_ANSWER"
        })
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Short-answer questions are not available in this beta yet."
    });
  });
});
