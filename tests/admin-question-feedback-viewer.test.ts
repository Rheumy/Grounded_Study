import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    questionFeedback: {
      findMany: vi.fn()
    },
    documentChunk: {
      findMany: vi.fn()
    }
  }
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn()
  })
}));

import { prisma } from "@/lib/db/prisma";
import {
  AdminQuestionFeedbackViewer,
  getFeedbackLabelText
} from "@/app/dashboard/admin/question-feedback-viewer";

describe("admin question feedback viewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.questionFeedback.findMany as any).mockResolvedValue([
      {
        id: "feedback-1",
        questionId: "question-1",
        createdAt: new Date("2026-05-27T01:00:00.000Z"),
        updatedAt: new Date("2026-05-27T01:05:00.000Z"),
        label: "GOOD_QUESTION",
        comment: null,
        user: { id: "user-1", email: "learner@example.com" },
        question: {
          id: "question-1",
          stem: "What is tested?",
          type: "MCQ",
          optionsJson: ["A", "B", "C", "D"],
          answer: "A",
          rationale: "Because the source says so.",
          citationsJson: [{ chunkId: "chunk-1", excerpt: "Source says so." }],
          verifierStatus: "PASSED",
          questionExposures: []
        }
      }
    ]);
    (prisma.documentChunk.findMany as any).mockResolvedValue([
      {
        id: "chunk-1",
        content: "Long source context.",
        page: 2,
        document: {
          title: "Beta Study Guide",
          sourceType: "PDF",
          storageKey: "uploads/beta.pdf"
        }
      }
    ]);
  });

  it("selects enough detail to inspect full question feedback", async () => {
    await AdminQuestionFeedbackViewer({ searchParams: {} });

    expect(prisma.questionFeedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          questionId: true,
          label: true,
          comment: true,
          user: expect.any(Object),
          question: {
            select: expect.objectContaining({
              stem: true,
              type: true,
              optionsJson: true,
              answer: true,
              rationale: true,
              citationsJson: true,
              verifierStatus: true,
              questionExposures: expect.any(Object)
            })
          }
        })
      })
    );
    expect(prisma.documentChunk.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: {
            in: ["chunk-1"]
          }
        }
      })
    );
  });

  it("keeps legacy labels displayable for existing rows", () => {
    expect(getFeedbackLabelText("GOOD_QUESTION" as any)).toBe("Legacy: Good question");
    expect(getFeedbackLabelText("IRRELEVANT" as any)).toBe("Legacy: Irrelevant");
  });
});
