import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-user-api", () => ({
  requireUserApi: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    question: {
      findFirst: vi.fn(),
      findMany: vi.fn()
    },
    spacedRepetitionSchedule: {
      findMany: vi.fn()
    }
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
import { markQuestionsServed } from "@/lib/questions/exposure";
import { GET } from "@/app/api/practice/next/route";

describe("practice next route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireUserApi as any).mockResolvedValue({ id: "user-1" });
  });

  it("returns TRUE_FALSE questions when the learner requests true/false practice", async () => {
    (prisma.question.findFirst as any).mockResolvedValue({
      id: "question-1",
      stem: "The statement is supported.",
      type: "TRUE_FALSE",
      optionsJson: ["True", "False"],
      difficulty: 2,
      tagsJson: null,
      questionFeedbacks: []
    });

    const response = await GET(
      new Request("http://localhost/api/practice/next?questionType=TRUE_FALSE&recycleMode=NONE")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      question: {
        id: "question-1",
        type: "TRUE_FALSE",
        optionsJson: ["True", "False"]
      }
    });
    expect(prisma.question.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              ownerId: "user-1",
              verifierStatus: "PASSED",
              type: "TRUE_FALSE"
            })
          ])
        })
      })
    );
    expect(markQuestionsServed).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: "user-1",
        questionIds: ["question-1"],
        mode: "PRACTICE"
      })
    );
  });
});
