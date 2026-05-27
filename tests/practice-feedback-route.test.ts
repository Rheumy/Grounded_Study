import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-user-api", () => ({
  requireUserApi: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    question: {
      findUnique: vi.fn()
    },
    practiceAttempt: {
      findFirst: vi.fn()
    },
    questionFeedback: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn()
    }
  }
}));

vi.mock("@/lib/questions/exposure", () => ({
  hideQuestionForUser: vi.fn()
}));

import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";
import { hideQuestionForUser } from "@/lib/questions/exposure";
import { POST as saveFeedback } from "@/app/api/practice/feedback/route";
import { POST as hideQuestion } from "@/app/api/questions/hide/route";

function feedbackRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/practice/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("practice question feedback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireUserApi as any).mockResolvedValue({ id: "user-1" });
    (prisma.question.findUnique as any).mockResolvedValue({ id: "question-1", ownerId: "user-1" });
    (prisma.practiceAttempt.findFirst as any).mockResolvedValue({ id: "attempt-1" });
    (prisma.questionFeedback.findUnique as any).mockResolvedValue(null);
    (prisma.questionFeedback.upsert as any).mockResolvedValue({
      label: "GOOD_EXAM_STYLE",
      comment: null,
      updatedAt: new Date("2026-05-27T01:00:00.000Z")
    });
    (prisma.questionFeedback.count as any).mockResolvedValue(0);
    (prisma.$transaction as any).mockImplementation(async (operations: Promise<unknown>[]) =>
      Promise.all(operations)
    );
  });

  it("accepts new beta feedback labels", async () => {
    (prisma.questionFeedback.upsert as any).mockResolvedValue({
      label: "POOR_WORDING",
      comment: "Sounds machine-written.",
      updatedAt: new Date("2026-05-27T01:00:00.000Z")
    });

    const response = await saveFeedback(
      feedbackRequest({
        questionId: "question-1",
        attemptId: "attempt-1",
        label: "POOR_WORDING",
        comment: "Sounds machine-written."
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      feedback: {
        label: "POOR_WORDING",
        comment: "Sounds machine-written."
      },
      hidesQuestionFromFuture: false
    });
    expect(prisma.questionFeedback.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ label: "POOR_WORDING" }),
        update: expect.objectContaining({ label: "POOR_WORDING" })
      })
    );
  });

  it("requires a comment for Other feedback", async () => {
    const response = await saveFeedback(
      feedbackRequest({
        questionId: "question-1",
        label: "OTHER"
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Add a short comment for Other feedback."
    });
    expect(prisma.questionFeedback.upsert).not.toHaveBeenCalled();
  });

  it("accepts Good exam-style question without a comment", async () => {
    const response = await saveFeedback(
      feedbackRequest({
        questionId: "question-1",
        label: "GOOD_EXAM_STYLE"
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      feedback: {
        label: "GOOD_EXAM_STYLE",
        comment: null
      },
      hidesQuestionFromFuture: false
    });
  });
});

describe("hide question route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireUserApi as any).mockResolvedValue({ id: "user-1" });
    (prisma.question.findUnique as any).mockResolvedValue({ id: "question-1", ownerId: "user-1" });
    (hideQuestionForUser as any).mockResolvedValue({ id: "exposure-1" });
  });

  it("still hides a question through the separate exposure path", async () => {
    const response = await hideQuestion(
      new Request("http://localhost/api/questions/hide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: "question-1" })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: "We’ll hide this question from your future practice and mock exams."
    });
    expect(hideQuestionForUser).toHaveBeenCalledWith(prisma, {
      userId: "user-1",
      questionId: "question-1"
    });
    expect(prisma.questionFeedback.upsert).not.toHaveBeenCalled();
  });
});
