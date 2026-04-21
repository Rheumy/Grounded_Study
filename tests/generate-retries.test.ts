import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    styleProfile: {
      findFirst: vi.fn()
    },
    question: {
      create: vi.fn()
    }
  }
}));

vi.mock("@/lib/llm/question-generator", () => ({
  generateQuestion: vi.fn()
}));

vi.mock("@/lib/llm/verifier/verifier", () => ({
  verifyQuestion: vi.fn()
}));

vi.mock("@/lib/retrieval/retrieve", () => ({
  retrieveChunks: vi.fn(),
  getEducationalChunkScore: vi.fn(() => 1),
  getNonEducationalChunkReason: vi.fn(() => null)
}));

vi.mock("@/lib/feedback/user-facing", () => ({
  sanitizeFeedbackText: (value: string) => value
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

import { prisma } from "@/lib/db/prisma";
import { generateQuestion } from "@/lib/llm/question-generator";
import { generateQuestions } from "@/lib/llm/generate";
import { retrieveChunks } from "@/lib/retrieval/retrieve";
import { verifyQuestion } from "@/lib/llm/verifier/verifier";

const seedChunk = {
  id: "seed-1",
  documentId: "doc-1",
  content: "Seed text for retrieval",
  page: 1,
  chunkIndex: 0
};

const chunkA = {
  id: "chunk-a",
  documentId: "doc-1",
  content: "Evidence A",
  page: 1,
  chunkIndex: 0
};

const chunkB = {
  id: "chunk-b",
  documentId: "doc-1",
  content: "Evidence B",
  page: 2,
  chunkIndex: 1
};

function buildGeneratedQuestion(chunkId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    type: "MCQ" as const,
    stem: "What does the source support?",
    options: ["A", "B", "C", "D"],
    answer: "A",
    rationale: "Because the source says so.",
    citations: [{ chunkId, excerpt: "Evidence", page: 1 }],
    difficulty: 2,
    tags: ["test"],
    verifierStatus: "PENDING" as const,
    ...overrides
  };
}

describe("generation retries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$queryRaw as any).mockResolvedValue([seedChunk]);
    (prisma.styleProfile.findFirst as any).mockResolvedValue(null);
    (prisma.question.create as any).mockResolvedValue({ id: "question-1" });
  });

  it("reuses the same retrieval when generation fails with malformed model output", async () => {
    (retrieveChunks as any).mockResolvedValue([chunkA]);
    (generateQuestion as any)
      .mockRejectedValueOnce(new Error("Model returned non-JSON content"))
      .mockResolvedValueOnce(buildGeneratedQuestion("chunk-a"));
    (verifyQuestion as any).mockResolvedValue({ status: "PASSED", reason: "Supported" });

    const results = await generateQuestions({
      ownerId: "user-1",
      documentIds: ["doc-1"],
      styleProfileId: null,
      difficulty: 2,
      count: 1
    });

    expect(retrieveChunks).toHaveBeenCalledTimes(1);
    expect(generateQuestion).toHaveBeenCalledTimes(2);
    expect((generateQuestion as any).mock.calls[0][0].chunks).toBe(
      (generateQuestion as any).mock.calls[1][0].chunks
    );
    expect((generateQuestion as any).mock.calls[0][0].styleProfile.assumedBackgroundLevel).toBe(
      "generalist"
    );
    expect((verifyQuestion as any).mock.calls[0][0].styleProfile.assumedBackgroundLevel).toBe(
      "generalist"
    );
    expect(results).toEqual([{ questionId: "question-1", status: "PASSED" }]);
  });

  it("refreshes retrieval when the first attempt fails for evidence reasons", async () => {
    (retrieveChunks as any).mockResolvedValueOnce([chunkA]).mockResolvedValueOnce([chunkB]);
    (generateQuestion as any)
      .mockResolvedValueOnce(
        buildGeneratedQuestion("chunk-a", { verifierStatus: "INSUFFICIENT_EVIDENCE" })
      )
      .mockResolvedValueOnce(buildGeneratedQuestion("chunk-b"));
    (verifyQuestion as any).mockResolvedValue({ status: "PASSED", reason: "Supported" });

    const results = await generateQuestions({
      ownerId: "user-1",
      documentIds: ["doc-1"],
      styleProfileId: null,
      difficulty: 2,
      count: 1
    });

    expect(retrieveChunks).toHaveBeenCalledTimes(2);
    expect((generateQuestion as any).mock.calls[0][0].chunks).not.toBe(
      (generateQuestion as any).mock.calls[1][0].chunks
    );
    expect(results).toEqual([{ questionId: "question-1", status: "PASSED" }]);
  });

  it("normalizes stored assumedBackgroundLevel before passing it to generation and verification", async () => {
    (prisma.styleProfile.findFirst as any).mockResolvedValue({
      id: "profile-1",
      name: "Specialist profile",
      schemaJson: {
        questionTypeDistribution: { MCQ: 1, SHORT_ANSWER: 0, TRUE_FALSE: 0 },
        assumedBackgroundLevel: "expert"
      },
      instructionsText: "Fellowship-style questions"
    });
    (retrieveChunks as any).mockResolvedValue([chunkA]);
    (generateQuestion as any).mockResolvedValue(buildGeneratedQuestion("chunk-a"));
    (verifyQuestion as any).mockResolvedValue({ status: "PASSED", reason: "Supported" });

    const results = await generateQuestions({
      ownerId: "user-1",
      documentIds: ["doc-1"],
      styleProfileId: "profile-1",
      difficulty: 3,
      count: 1
    });

    expect((generateQuestion as any).mock.calls[0][0].styleProfile.assumedBackgroundLevel).toBe(
      "specialist"
    );
    expect((verifyQuestion as any).mock.calls[0][0].styleProfile.assumedBackgroundLevel).toBe(
      "specialist"
    );
    expect(results).toEqual([{ questionId: "question-1", status: "PASSED" }]);
  });

  it("grants one additional refreshed attempt for outsider-style verifier rejections", async () => {
    (retrieveChunks as any)
      .mockResolvedValueOnce([chunkA])
      .mockResolvedValueOnce([chunkB])
      .mockResolvedValueOnce([chunkA])
      .mockResolvedValueOnce([chunkB]);
    (generateQuestion as any)
      .mockResolvedValueOnce(buildGeneratedQuestion("chunk-a", { type: "TRUE_FALSE", options: ["True", "False"], answer: "True" }))
      .mockResolvedValueOnce(buildGeneratedQuestion("chunk-b", { type: "TRUE_FALSE", options: ["True", "False"], answer: "True" }))
      .mockResolvedValueOnce(buildGeneratedQuestion("chunk-a", { type: "TRUE_FALSE", options: ["True", "False"], answer: "True" }))
      .mockResolvedValueOnce(buildGeneratedQuestion("chunk-b", { type: "TRUE_FALSE", options: ["True", "False"], answer: "True" }));
    (verifyQuestion as any)
      .mockResolvedValueOnce({
        status: "FAILED",
        reason:
          "True/false statement reads like a field-general summary that could be answered without studying the cited source",
        failureCodes: ["LOW_EDUCATIONAL_VALUE", "INVALID_TRUE_FALSE"]
      })
      .mockResolvedValueOnce({
        status: "FAILED",
        reason:
          "True/false statement reads like a field-general summary that could be answered without studying the cited source",
        failureCodes: ["LOW_EDUCATIONAL_VALUE", "INVALID_TRUE_FALSE"]
      })
      .mockResolvedValueOnce({
        status: "FAILED",
        reason:
          "True/false statement reads like a field-general summary that could be answered without studying the cited source",
        failureCodes: ["LOW_EDUCATIONAL_VALUE", "INVALID_TRUE_FALSE"]
      })
      .mockResolvedValueOnce({ status: "PASSED", reason: "Supported" });

    const results = await generateQuestions({
      ownerId: "user-1",
      documentIds: ["doc-1"],
      styleProfileId: null,
      difficulty: 3,
      count: 1,
      typeMix: { TRUE_FALSE: 1 }
    });

    expect(retrieveChunks).toHaveBeenCalledTimes(4);
    expect(generateQuestion).toHaveBeenCalledTimes(4);
    expect(verifyQuestion).toHaveBeenCalledTimes(4);
    expect(results).toEqual([{ questionId: "question-1", status: "PASSED" }]);
  });
});
