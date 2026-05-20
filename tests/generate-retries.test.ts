import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    styleProfile: {
      findFirst: vi.fn()
    },
    question: {
      create: vi.fn()
    },
    chunkUsage: {
      createMany: vi.fn()
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

vi.mock("@/lib/feedback/user-facing", async () => {
  const actual = await vi.importActual<typeof import("@/lib/feedback/user-facing")>(
    "@/lib/feedback/user-facing"
  );
  return actual;
});

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
    (prisma.chunkUsage.createMany as any).mockResolvedValue({ count: 1 });
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
    expect((generateQuestion as any).mock.calls[0][0].questionType).toBe("MCQ");
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

  it("clamps legacy short-answer-only profile distributions to the MCQ fallback", async () => {
    (prisma.styleProfile.findFirst as any).mockResolvedValue({
      id: "profile-1",
      name: "Legacy short-answer profile",
      schemaJson: {
        questionTypeDistribution: { MCQ: 0, SHORT_ANSWER: 1, TRUE_FALSE: 0 },
        assumedBackgroundLevel: "generalist"
      },
      instructionsText: null
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

    expect((generateQuestion as any).mock.calls[0][0].questionType).toBe("MCQ");
    expect(results).toEqual([{ questionId: "question-1", status: "PASSED" }]);
  });

  it("records one chunk-usage row per cited chunk after saving a question", async () => {
    (retrieveChunks as any).mockResolvedValue([chunkA, chunkB]);
    (generateQuestion as any).mockResolvedValue(
      buildGeneratedQuestion("chunk-a", {
        citations: [
          { chunkId: "chunk-a", excerpt: "Evidence A", page: 1 },
          { chunkId: "chunk-b", excerpt: "Evidence B", page: 2 },
          { chunkId: "chunk-a", excerpt: "Evidence A again", page: 1 }
        ]
      })
    );
    (verifyQuestion as any).mockResolvedValue({ status: "PASSED", reason: "Supported" });

    const results = await generateQuestions({
      ownerId: "user-1",
      documentIds: ["doc-1"],
      styleProfileId: null,
      difficulty: 2,
      count: 1
    });

    expect(prisma.chunkUsage.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: "user-1",
          documentId: "doc-1",
          chunkId: "chunk-a",
          questionId: "question-1"
        },
        {
          userId: "user-1",
          documentId: "doc-1",
          chunkId: "chunk-b",
          questionId: "question-1"
        }
      ]
    });
    expect(results).toEqual([{ questionId: "question-1", status: "PASSED" }]);
  });

  it("sanitizes learner-facing evidence framing before storing a generated question", async () => {
    (retrieveChunks as any).mockResolvedValue([chunkA]);
    (generateQuestion as any).mockResolvedValue(
      buildGeneratedQuestion("chunk-a", {
        type: "TRUE_FALSE",
        stem:
          "According to the data provided on alkaptonuria management, oral administration of nitisinone completely reverses urinary HGA excretion.",
        options: [
          "True according to the evidence provided",
          "False based on the provided evidence"
        ],
        answer: "True according to the evidence provided",
        rationale:
          "The data provided shows that oral nitisinone completely reverses urinary HGA excretion.",
        citations: [{ chunkId: "chunk-a", excerpt: "Evidence A", page: 1 }]
      })
    );
    (verifyQuestion as any).mockResolvedValue({ status: "PASSED", reason: "Supported" });

    const results = await generateQuestions({
      ownerId: "user-1",
      documentIds: ["doc-1"],
      styleProfileId: null,
      difficulty: 2,
      count: 1,
      typeMix: { TRUE_FALSE: 1 }
    });

    expect(prisma.question.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stem:
          "Oral administration of nitisinone completely reverses urinary HGA excretion.",
        optionsJson: ["True", "False"],
        answer: "True",
        rationale: "Oral nitisinone completely reverses urinary HGA excretion."
      })
    });
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

  it("switches to a narrow source-specific retry angle after outsider-style rejection", async () => {
    const detailedChunk = {
      ...chunkA,
      content:
        "Compared with the 50 mg regimen, the 100 mg regimen achieved week 12 response in 68% versus 42% of patients."
    };

    (retrieveChunks as any).mockResolvedValueOnce([detailedChunk]).mockResolvedValueOnce([chunkB]);
    (generateQuestion as any)
      .mockResolvedValueOnce(
        buildGeneratedQuestion("chunk-a", {
          type: "TRUE_FALSE",
          options: ["True", "False"],
          answer: "True"
        })
      )
      .mockResolvedValueOnce(buildGeneratedQuestion("chunk-b"));
    (verifyQuestion as any)
      .mockResolvedValueOnce({
        status: "FAILED",
        reason:
          "The proposition can be answered correctly based on general knowledge without needing specific details from the cited material.",
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

    expect((retrieveChunks as any).mock.calls[0][0].query).toBe("Seed text for retrieval");
    expect((retrieveChunks as any).mock.calls[1][0].query).toContain("week 12 response");
    expect((retrieveChunks as any).mock.calls[1][0].query).not.toBe(
      (retrieveChunks as any).mock.calls[0][0].query
    );
    expect((generateQuestion as any).mock.calls[1][0].retryContext).toEqual({
      strategy: "narrow_source_specific",
      previousFailureReason:
        "The proposition can be answered correctly based on general knowledge without needing specific details from the cited material."
    });
    expect(results).toEqual([{ questionId: "question-1", status: "PASSED" }]);
  });
});
