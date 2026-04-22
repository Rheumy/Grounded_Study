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
});
