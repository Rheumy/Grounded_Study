import { beforeEach, describe, expect, it, vi } from "vitest";

const createCompletionMock = vi.fn();

vi.mock("@/lib/llm/openai", () => ({
  getOpenAIClient: () => ({
    chat: {
      completions: {
        create: createCompletionMock
      }
    }
  })
}));

vi.mock("@/lib/observability/ai-usage", () => ({
  recordOpenAiUsageEvent: vi.fn()
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

import { generateQuestion } from "@/lib/llm/question-generator";

const baseChunk = {
  id: "chunk-1",
  content:
    "IL-23 blockade reduced relapse\nwithin 12 weeks compared with placebo in the studied cohort.",
  page: 4
};

function buildResponse(content: Record<string, unknown>) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(content)
        }
      }
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150
    }
  };
}

describe("question generator citation handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("repairs whitespace-normalized excerpts back to the exact chunk substring", async () => {
    createCompletionMock.mockResolvedValueOnce(
      buildResponse({
        type: "TRUE_FALSE",
        stem: "IL-23 blockade reduced relapse within 12 weeks compared with placebo. True or false?",
        answer: "True",
        rationale: "The cited evidence explicitly states that relapse was reduced within 12 weeks compared with placebo.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt:
              "IL-23 blockade reduced relapse within 12 weeks compared with placebo"
          }
        ],
        difficulty: 3
      })
    );

    const result = await generateQuestion({
      styleProfile: { assumedBackgroundLevel: "specialist" },
      difficulty: 3,
      questionType: "TRUE_FALSE",
      chunks: [baseChunk]
    });

    expect(result.citations[0]?.excerpt).toBe(
      "IL-23 blockade reduced relapse\nwithin 12 weeks compared with placebo"
    );
    expect(baseChunk.content.includes(result.citations[0]?.excerpt ?? "")).toBe(true);
  });

  it("normalizes a valid TRUE_FALSE response into the canonical schema", async () => {
    createCompletionMock.mockResolvedValueOnce(
      buildResponse({
        type: "TRUE_FALSE",
        stem: "IL-23 blockade reduced relapse within 12 weeks compared with placebo.",
        options: ["True", "False"],
        answer: "The statement is true.",
        rationale:
          "The cited evidence states that IL-23 blockade reduced relapse within 12 weeks compared with placebo.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt:
              "IL-23 blockade reduced relapse\nwithin 12 weeks compared with placebo",
            page: 4
          }
        ],
        difficulty: 3
      })
    );

    const result = await generateQuestion({
      styleProfile: { assumedBackgroundLevel: "generalist" },
      difficulty: 3,
      questionType: "TRUE_FALSE",
      chunks: [baseChunk]
    });

    expect(result).toMatchObject({
      type: "TRUE_FALSE",
      options: ["True", "False"],
      answer: "True",
      verifierStatus: "PENDING"
    });
  });

  it("normalizes boolean TRUE_FALSE answers into canonical strings", async () => {
    createCompletionMock.mockResolvedValueOnce(
      buildResponse({
        type: "TRUE_FALSE",
        stem: "IL-23 blockade did not reduce relapse within 12 weeks compared with placebo.",
        options: [true, false],
        answer: false,
        rationale:
          "The cited evidence states that IL-23 blockade reduced relapse within 12 weeks compared with placebo.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt:
              "IL-23 blockade reduced relapse\nwithin 12 weeks compared with placebo",
            page: 4
          }
        ],
        difficulty: 3
      })
    );

    const result = await generateQuestion({
      styleProfile: { assumedBackgroundLevel: "generalist" },
      difficulty: 3,
      questionType: "TRUE_FALSE",
      chunks: [baseChunk]
    });

    expect(result.type).toBe("TRUE_FALSE");
    expect(result.options).toEqual(["True", "False"]);
    expect(result.answer).toBe("False");
  });

  it("adds TRUE_FALSE-specific retry guidance after a wrong-type response", async () => {
    createCompletionMock.mockResolvedValueOnce(
      buildResponse({
        type: "TRUE_FALSE",
        stem: "IL-23 blockade reduced relapse within 12 weeks compared with placebo.",
        options: ["True", "False"],
        answer: "True",
        rationale:
          "The cited evidence states that IL-23 blockade reduced relapse within 12 weeks compared with placebo.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt:
              "IL-23 blockade reduced relapse\nwithin 12 weeks compared with placebo",
            page: 4
          }
        ],
        difficulty: 3
      })
    );

    await generateQuestion({
      styleProfile: { assumedBackgroundLevel: "generalist" },
      difficulty: 3,
      questionType: "TRUE_FALSE",
      chunks: [baseChunk],
      retryContext: {
        strategy: "type_correction",
        previousFailureReason: "Generated MCQ when TRUE_FALSE was requested"
      }
    });

    const userMessage = createCompletionMock.mock.calls[0]?.[0].messages[1].content;
    expect(userMessage).toContain('`type` must be exactly `"TRUE_FALSE"`');
    expect(userMessage).toContain('`options` must be exactly `["True", "False"]`');
  });

  it("fails fast when the citation excerpt cannot be repaired to exact chunk text", async () => {
    createCompletionMock.mockResolvedValueOnce(
      buildResponse({
        type: "MCQ",
        stem: "Which pathway was highlighted as especially important?",
        options: [
          "IL-23 pathway",
          "TNF-alpha pathway",
          "IL-17 pathway",
          "JAK pathway"
        ],
        answer: "IL-23 pathway",
        rationale: "The source focused on IL-23 in psoriasis management.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt: "IL-23 is widely used in psoriasis therapy"
          }
        ],
        difficulty: 2
      })
    );

    await expect(
      generateQuestion({
        styleProfile: { assumedBackgroundLevel: "specialist" },
        difficulty: 2,
        questionType: "MCQ",
        chunks: [baseChunk]
      })
    ).rejects.toThrow("Citation excerpt does not match the cited evidence");
  });

  it("repairs short paraphrased excerpts to the verbatim chunk span via fuzzy alignment", async () => {
    const fuzzyChunk = {
      id: "chunk-2",
      content:
        "Patients with active disease were advised to avoid live vaccines during treatment and for 3 months afterward.",
      page: 6
    };

    createCompletionMock.mockResolvedValueOnce(
      buildResponse({
        type: "TRUE_FALSE",
        stem: "Patients with active disease should avoid live vaccines during treatment for 3 months afterward. True or false?",
        answer: "True",
        rationale:
          "The cited evidence states that live vaccines should be avoided during treatment and for 3 months afterward.",
        citations: [
          {
            chunkId: "chunk-2",
            excerpt: "avoid live vaccines during treatment for 3 months afterward"
          }
        ],
        difficulty: 3
      })
    );

    const result = await generateQuestion({
      styleProfile: { assumedBackgroundLevel: "specialist" },
      difficulty: 3,
      questionType: "TRUE_FALSE",
      chunks: [baseChunk, fuzzyChunk]
    });

    expect(result.citations[0]?.chunkId).toBe("chunk-2");
    expect(result.citations[0]?.excerpt).not.toBe(
      "avoid live vaccines during treatment for 3 months afterward"
    );
    expect(result.citations[0]?.excerpt).toBe(
      "avoid live vaccines during treatment and for 3 months"
    );
    expect(fuzzyChunk.content.includes(result.citations[0]?.excerpt ?? "")).toBe(true);
  });

  it("shuffles MCQ options while preserving the canonical answer text", async () => {
    const randomValues = [
      0.99, 0.99, 0.99,
      0.99, 0.99, 0,
      0.99, 0, 0.99,
      0, 0.99, 0.99
    ];
    let randomCallCount = 0;
    const randomSpy = vi.spyOn(Math, "random").mockImplementation(() => {
      const value = randomValues[randomCallCount % randomValues.length] ?? 0.5;
      randomCallCount += 1;
      return value;
    });

    createCompletionMock.mockResolvedValue(
      buildResponse({
        type: "MCQ",
        stem: "Which CRISPR-Cas9 detail is supported for the system described in the source?",
        options: [
          "Seed-region complementarity near the PAM",
          "PAM recognition is unnecessary once guide RNA binds",
          "Distal mismatches completely prevent every cleavage event",
          "Cas9 cuts RNA targets more efficiently than DNA targets"
        ],
        answer: "Seed-region complementarity near the PAM",
        rationale:
          "The source states that efficient cleavage required seed-region complementarity near the PAM.",
        citations: [
          {
            chunkId: "chunk-2",
            excerpt: "seed-region complementarity near the PAM was required for efficient cleavage",
            page: 7
          }
        ],
        difficulty: 3
      })
    );

    const positions = new Set<number>();
    const mcqChunk = {
      id: "chunk-2",
      content:
        "In the described system, seed-region complementarity near the PAM was required for efficient cleavage, while some distal mismatches were tolerated.",
      page: 7
    };

    try {
      for (let index = 0; index < 100; index += 1) {
        const result = await generateQuestion({
          styleProfile: { assumedBackgroundLevel: "specialist" },
          difficulty: 3,
          questionType: "MCQ",
          chunks: [mcqChunk]
        });

        expect(result.options).toContain(result.answer);
        positions.add(result.options?.indexOf(result.answer) ?? -1);
      }
    } finally {
      randomSpy.mockRestore();
    }

    expect([...positions].sort()).toEqual([0, 1, 2, 3]);
  });
});
