import { beforeEach, describe, expect, it, vi } from "vitest";

const createCompletion = vi.fn();

vi.mock("@/lib/llm/openai", () => ({
  getOpenAIClient: () => ({
    chat: {
      completions: {
        create: createCompletion
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

import { verifyQuestion } from "@/lib/llm/verifier/verifier";

describe("verifier outsider test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              status: "PASSED",
              reason: "Supported",
              failureCodes: [],
              confidence: "HIGH"
            })
          }
        }
      ]
    });
  });

  it("rejects broad true/false statements that a specialist-level outsider could answer without the source", async () => {
    const result = await verifyQuestion({
      question: {
        type: "TRUE_FALSE",
        stem: "Chemical peels are effective procedures for treating acne scarring.",
        options: ["True", "False"],
        answer: "True",
        rationale:
          "The cited material notes that chemical peels are used to improve acne scarring.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt: "chemical peels are used to improve acne scarring",
            page: 1
          }
        ],
        difficulty: 2,
        verifierStatus: "PENDING"
      },
      chunks: [
        {
          id: "chunk-1",
          content:
            "Chemical peels are used to improve acne scarring in selected patients, alongside other resurfacing options.",
          page: 1
        }
      ],
      styleProfile: {
        assumedBackgroundLevel: "specialist"
      }
    });

    expect(result.status).toBe("FAILED");
    expect(result.failureCodes).toEqual(
      expect.arrayContaining(["LOW_EDUCATIONAL_VALUE", "INVALID_TRUE_FALSE"])
    );
  });

  it("does not auto-reject a concise source-specific true/false claim just because the topic is familiar", async () => {
    const result = await verifyQuestion({
      question: {
        type: "TRUE_FALSE",
        stem: "Compared with the 50 mg regimen, the 100 mg regimen reached response by week 12 more often.",
        options: ["True", "False"],
        answer: "True",
        rationale:
          "The cited material reports a higher week-12 response rate with the 100 mg regimen than with the 50 mg regimen.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt: "week 12 response was higher with 100 mg than with 50 mg",
            page: 1
          }
        ],
        difficulty: 3,
        verifierStatus: "PENDING"
      },
      chunks: [
        {
          id: "chunk-1",
          content:
            "In the study cohort, week 12 response was higher with 100 mg than with 50 mg, despite similar baseline severity.",
          page: 1
        }
      ],
      styleProfile: {
        assumedBackgroundLevel: "specialist"
      }
    });

    expect(result.status).toBe("PASSED");
  });

  it("does not auto-reject a familiar topic in generalist mode when the exact claim depends on a narrower source detail", async () => {
    const result = await verifyQuestion({
      question: {
        type: "MCQ",
        stem: "Which CRISPR-Cas9 detail is supported for the system described in the source?",
        options: [
          "Cleavage requires seed-region complementarity near the PAM rather than full-length matching across the guide",
          "Cleavage is independent of PAM recognition once guide RNA is present",
          "Any mismatch in the distal guide region prevents cleavage completely",
          "Cas9 cuts RNA targets more efficiently than DNA targets in this system"
        ],
        answer:
          "Cleavage requires seed-region complementarity near the PAM rather than full-length matching across the guide",
        rationale:
          "The cited evidence narrows the claim to seed-region complementarity near the PAM, which is a specific mechanistic detail rather than a generic overview of CRISPR-Cas9.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt: "seed-region complementarity near the PAM was required for efficient cleavage",
            page: 1
          }
        ],
        difficulty: 3,
        verifierStatus: "PENDING"
      },
      chunks: [
        {
          id: "chunk-1",
          content:
            "In the described system, seed-region complementarity near the PAM was required for efficient cleavage, whereas distal mismatches were sometimes tolerated.",
          page: 1
        }
      ],
      styleProfile: {
        assumedBackgroundLevel: "generalist"
      }
    });

    expect(result.status).toBe("PASSED");
  });
});
