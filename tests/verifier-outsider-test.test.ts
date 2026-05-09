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
import { logger } from "@/lib/observability/logger";

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
      expect.arrayContaining(["OUTSIDER_SOLVABLE", "INVALID_TRUE_FALSE"])
    );
  });

  it("does not auto-reject a concise source-specific true/false claim just because the topic is familiar", async () => {
    createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              status: "PASSED",
              reason: "Supported",
              failureCodes: [],
              confidence: "HIGH",
              supportedAnswer: "True"
            })
          }
        }
      ]
    });

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

  it("rejects a true/false item when the citation supports the opposite answer key", async () => {
    createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              status: "PASSED",
              reason: "The cited evidence supports the statement as written.",
              failureCodes: [],
              confidence: "HIGH",
              supportedAnswer: "True"
            })
          }
        }
      ]
    });

    const result = await verifyQuestion({
      question: {
        type: "TRUE_FALSE",
        stem:
          "In cases of suspected occult spinal dysraphism, MRI is the imaging modality of choice and is highly sensitive, even in infants younger than 5 months old.",
        options: ["True", "False"],
        answer: "False",
        rationale:
          "MRI is preferred and highly sensitive, while ultrasonographic evaluation is less sensitive than MRI in infants younger than 5 months, so the original statement is inaccurate.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt:
              "MRI is highly sensitive and represents the imaging modality of choice in patients of all ages when occult spinal dysraphism is suspected. Although the vertebrae are not yet completely ossified in infants < 5 months of age, ultrasonographic evaluation of the spinal cord is still less sensitive than MRI in this age group.",
            page: 8
          }
        ],
        difficulty: 3,
        verifierStatus: "PENDING"
      },
      chunks: [
        {
          id: "chunk-1",
          content:
            "MRI is highly sensitive and represents the imaging modality of choice in patients of all ages when occult spinal dysraphism is suspected. Although the vertebrae are not yet completely ossified in infants < 5 months of age, ultrasonographic evaluation of the spinal cord is still less sensitive than MRI in this age group.",
          page: 8
        }
      ],
      styleProfile: {
        assumedBackgroundLevel: "specialist"
      }
    });

    expect(result.status).toBe("FAILED");
    expect(result.reason).toContain("supports True, not the keyed answer False");
    expect(result.failureCodes).toEqual(
      expect.arrayContaining(["UNSUPPORTED_ANSWER", "INVALID_TRUE_FALSE"])
    );
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

  it("soft-passes an outsider-only verifier signal when the question passes other checks", async () => {
    createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              status: "FAILED",
              reason:
                "The question can be answered by a generalist without requiring source-specific information.",
              failureCodes: ["LOW_EDUCATIONAL_VALUE"],
              confidence: "MEDIUM"
            })
          }
        }
      ]
    });

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
      },
      userId: "user-1"
    });

    expect(result.status).toBe("PASSED");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        questionType: "MCQ",
        reason:
          "The question can be answered by a generalist without requiring source-specific information."
      }),
      "Outsider-test signal fired but question passed other checks"
    );
  });

  it("still fails when outsider-test signal co-occurs with another verifier failure", async () => {
    createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              status: "FAILED",
              reason:
                "The question can be answered by a generalist without requiring source-specific information.",
              failureCodes: ["LOW_EDUCATIONAL_VALUE", "UNSUPPORTED_ANSWER"],
              confidence: "HIGH"
            })
          }
        }
      ]
    });

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

    expect(result.status).toBe("FAILED");
    expect(result.failureCodes).toEqual(
      expect.arrayContaining(["OUTSIDER_SOLVABLE", "UNSUPPORTED_ANSWER"])
    );
    expect(result.failureCodes).not.toContain("LOW_EDUCATIONAL_VALUE");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        questionType: "MCQ",
        failureCodes: expect.arrayContaining(["OUTSIDER_SOLVABLE", "UNSUPPORTED_ANSWER"]),
        reason:
          "The question can be answered by a generalist without requiring source-specific information."
      }),
      "Verifier rejected question that failed the outsider test"
    );
  });

  it("keeps LOW_EDUCATIONAL_VALUE as a hard fail for genuine metadata-targeted questions", async () => {
    const result = await verifyQuestion({
      question: {
        type: "TRUE_FALSE",
        stem: "The reference list appears after the appendix in this document.",
        options: ["True", "False"],
        answer: "True",
        rationale:
          "The source structure places the reference list after the appendix section.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt: "Appendix A is followed by the reference list",
            page: 12
          }
        ],
        difficulty: 1,
        verifierStatus: "PENDING"
      },
      chunks: [
        {
          id: "chunk-1",
          content:
            "Appendix A is followed by the reference list and then the author biography section.",
          page: 12
        }
      ],
      styleProfile: {
        assumedBackgroundLevel: "generalist"
      }
    });

    expect(result.status).toBe("FAILED");
    expect(result.failureCodes).toEqual(expect.arrayContaining(["LOW_EDUCATIONAL_VALUE"]));
    expect(result.failureCodes).not.toContain("OUTSIDER_SOLVABLE");
  });

  it("fails when outsider-solvable signal co-occurs with LOW_EDUCATIONAL_VALUE", async () => {
    createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              status: "FAILED",
              reason:
                "The question can be answered based on general knowledge without requiring source-specific information.",
              failureCodes: ["LOW_EDUCATIONAL_VALUE"],
              confidence: "MEDIUM"
            })
          }
        }
      ]
    });

    const result = await verifyQuestion({
      question: {
        type: "TRUE_FALSE",
        stem: "The reference list appears after the appendix in this document.",
        options: ["True", "False"],
        answer: "True",
        rationale:
          "The source structure places the reference list after the appendix section.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt: "Appendix A is followed by the reference list",
            page: 12
          }
        ],
        difficulty: 1,
        verifierStatus: "PENDING"
      },
      chunks: [
        {
          id: "chunk-1",
          content:
            "Appendix A is followed by the reference list and then the author biography section.",
          page: 12
        }
      ],
      styleProfile: {
        assumedBackgroundLevel: "generalist"
      }
    });

    expect(result.status).toBe("FAILED");
    expect(result.failureCodes).toEqual(
      expect.arrayContaining(["OUTSIDER_SOLVABLE", "LOW_EDUCATIONAL_VALUE"])
    );
  });

  it("keeps hard citation invariants ahead of outsider handling", async () => {
    createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              status: "FAILED",
              reason:
                "The question can be answered by a generalist without requiring source-specific information.",
              failureCodes: ["LOW_EDUCATIONAL_VALUE"],
              confidence: "MEDIUM"
            })
          }
        }
      ]
    });

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
            chunkId: "missing-chunk",
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
    expect(result.reason).toBe("Citation references an unknown chunk");
    expect(result.failureCodes).toEqual(["BAD_CITATION_LINKAGE"]);
    expect(createCompletion).not.toHaveBeenCalled();
  });
});
