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

  it("does not reject a source-grounded true/false item solely for outsider-solvable concern", async () => {
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

    expect(result.status).toBe("PASSED");
    expect(result.failureCodes ?? []).not.toContain("INVALID_TRUE_FALSE");
  });

  it("rejects copied true/false stems before LLM review", async () => {
    const result = await verifyQuestion({
      question: {
        type: "TRUE_FALSE",
        stem:
          "Efficient cleavage required seed-region complementarity near the PAM, whereas some distal guide mismatches were tolerated.",
        options: ["True", "False"],
        answer: "True",
        rationale:
          "The cited material distinguishes the seed-region requirement from tolerated distal mismatches.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt:
              "Efficient cleavage required seed-region complementarity near the PAM, whereas some distal guide mismatches were tolerated.",
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
            "Efficient cleavage required seed-region complementarity near the PAM, whereas some distal guide mismatches were tolerated.",
          page: 1
        }
      ],
      styleProfile: {
        assumedBackgroundLevel: "generalist"
      }
    });

    expect(result.status).toBe("FAILED");
    expect(result.failureCodes).toEqual(
      expect.arrayContaining(["LOW_EDUCATIONAL_VALUE"])
    );
    expect(result.failureCodes ?? []).not.toContain("INVALID_TRUE_FALSE");
    expect(result.reason).toContain("too close to the cited source wording");
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it("labels malformed true/false structure as INVALID_TRUE_FALSE", async () => {
    const result = await verifyQuestion({
      question: {
        type: "TRUE_FALSE",
        stem:
          "Which option best describes the cited seed-region requirement?",
        options: ["Seed region", "PAM", "Distal guide", "Cas9"],
        answer: "Seed region",
        rationale:
          "The cited material states that efficient cleavage required seed-region complementarity near the PAM.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt:
              "Efficient cleavage required seed-region complementarity near the PAM",
            page: 1
          }
        ],
        difficulty: 2,
        verifierStatus: "PENDING"
      } as any,
      chunks: [
        {
          id: "chunk-1",
          content:
            "Efficient cleavage required seed-region complementarity near the PAM, whereas some distal guide mismatches were tolerated.",
          page: 1
        }
      ],
      styleProfile: {
        assumedBackgroundLevel: "generalist"
      }
    });

    expect(result.status).toBe("FAILED");
    expect(result.failureCodes).toEqual(
      expect.arrayContaining(["INVALID_TRUE_FALSE", "INVALID_STRUCTURE"])
    );
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it("allows implication-based true/false stems that depend on a cited distinction", async () => {
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
        stem:
          "Because the PAM-proximal seed match was the required feature, errors farther from the PAM did not automatically prevent cleavage.",
        options: ["True", "False"],
        answer: "True",
        rationale:
          "The evidence makes seed-region complementarity near the PAM the required feature while noting that some distal guide mismatches were tolerated.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt:
              "Efficient cleavage required seed-region complementarity near the PAM, whereas some distal guide mismatches were tolerated.",
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
            "Efficient cleavage required seed-region complementarity near the PAM, whereas some distal guide mismatches were tolerated.",
          page: 1
        }
      ],
      styleProfile: {
        assumedBackgroundLevel: "generalist"
      }
    });

    expect(result.status).toBe("PASSED");
  });

  it("does not reject a passed TRUE_FALSE verifier response solely because supportedAnswer is omitted", async () => {
    createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              status: "PASSED",
              reason: "The cited evidence supports the keyed truth value.",
              failureCodes: [],
              confidence: "HIGH"
            })
          }
        }
      ]
    });

    const result = await verifyQuestion({
      question: {
        type: "TRUE_FALSE",
        stem:
          "Because the PAM-proximal seed match was the required feature, errors farther from the PAM did not automatically prevent cleavage.",
        options: ["True", "False"],
        answer: "True",
        rationale:
          "The evidence makes seed-region complementarity near the PAM the required feature while noting that some distal guide mismatches were tolerated.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt:
              "Efficient cleavage required seed-region complementarity near the PAM, whereas some distal guide mismatches were tolerated.",
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
            "Efficient cleavage required seed-region complementarity near the PAM, whereas some distal guide mismatches were tolerated.",
          page: 1
        }
      ],
      styleProfile: {
        assumedBackgroundLevel: "generalist"
      }
    });

    expect(result.status).toBe("PASSED");
  });

  it("normalizes sentence-form supportedAnswer values for TRUE_FALSE verification", async () => {
    createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              status: "PASSED",
              reason: "The cited evidence supports the keyed truth value.",
              failureCodes: [],
              confidence: "HIGH",
              supportedAnswer: "The statement is true."
            })
          }
        }
      ]
    });

    const result = await verifyQuestion({
      question: {
        type: "TRUE_FALSE",
        stem:
          "Because the PAM-proximal seed match was the required feature, errors farther from the PAM did not automatically prevent cleavage.",
        options: ["True", "False"],
        answer: "True",
        rationale:
          "The evidence makes seed-region complementarity near the PAM the required feature while noting that some distal guide mismatches were tolerated.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt:
              "Efficient cleavage required seed-region complementarity near the PAM, whereas some distal guide mismatches were tolerated.",
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
            "Efficient cleavage required seed-region complementarity near the PAM, whereas some distal guide mismatches were tolerated.",
          page: 1
        }
      ],
      styleProfile: {
        assumedBackgroundLevel: "generalist"
      }
    });

    expect(result.status).toBe("PASSED");
  });

  it("rejects generic non-observation adverse-effect negation traps at difficulty 5", async () => {
    const result = await verifyQuestion({
      question: {
        type: "TRUE_FALSE",
        stem:
          "A study that does not observe an adverse effect necessarily means the medication does not cause the adverse effect in question.",
        options: ["True", "False"],
        answer: "False",
        rationale:
          "A non-observed adverse effect does not by itself prove the medication cannot cause that effect.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt: "the study did not detect a statistically significant increase in adverse events",
            page: 2
          }
        ],
        difficulty: 5,
        verifierStatus: "PENDING"
      },
      chunks: [
        {
          id: "chunk-1",
          content:
            "In this cohort, the study did not detect a statistically significant increase in adverse events, but the authors noted that rare effects could not be excluded.",
          page: 2
        }
      ],
      styleProfile: {
        assumedBackgroundLevel: "specialist"
      }
    });

    expect(result.status).toBe("FAILED");
    expect(result.failureCodes).toEqual(
      expect.arrayContaining(["LOW_EDUCATIONAL_VALUE"])
    );
    expect(result.failureCodes ?? []).not.toContain("INVALID_TRUE_FALSE");
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it("rejects broad obvious true/false items at difficulty 5", async () => {
    const result = await verifyQuestion({
      question: {
        type: "TRUE_FALSE",
        stem: "Medications can cause adverse drug reactions.",
        options: ["True", "False"],
        answer: "True",
        rationale:
          "The source discusses adverse drug reactions occurring during medication use.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt: "Adverse drug reactions may occur during medication use",
            page: 3
          }
        ],
        difficulty: 5,
        verifierStatus: "PENDING"
      },
      chunks: [
        {
          id: "chunk-1",
          content:
            "Adverse drug reactions may occur during medication use and require monitoring in higher-risk patients.",
          page: 3
        }
      ],
      styleProfile: {
        assumedBackgroundLevel: "generalist"
      }
    });

    expect(result.status).toBe("FAILED");
    expect(result.failureCodes).toEqual(
      expect.arrayContaining(["LOW_EDUCATIONAL_VALUE"])
    );
    expect(result.failureCodes ?? []).not.toContain("INVALID_TRUE_FALSE");
  });

  it("allows grounded true/false items at difficulty 2 when they depend on source detail", async () => {
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
        stem:
          "The studied cohort showed a 12-week relapse difference favoring IL-23 blockade over placebo.",
        options: ["True", "False"],
        answer: "True",
        rationale:
          "The cited material reports a relapse reduction within 12 weeks compared with placebo.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt: "IL-23 blockade reduced relapse within 12 weeks compared with placebo",
            page: 4
          }
        ],
        difficulty: 2,
        verifierStatus: "PENDING"
      },
      chunks: [
        {
          id: "chunk-1",
          content:
            "IL-23 blockade reduced relapse within 12 weeks compared with placebo in the studied cohort.",
          page: 4
        }
      ],
      styleProfile: {
        assumedBackgroundLevel: "generalist"
      }
    });

    expect(result.status).toBe("PASSED");
  });

  it("allows source-grounded false true/false items", async () => {
    createCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              status: "PASSED",
              reason: "Supported",
              failureCodes: [],
              confidence: "HIGH",
              supportedAnswer: "False"
            })
          }
        }
      ]
    });

    const result = await verifyQuestion({
      question: {
        type: "TRUE_FALSE",
        stem:
          "Distal guide mismatches completely prevented cleavage in the described system.",
        options: ["True", "False"],
        answer: "False",
        rationale:
          "The cited material says some distal guide mismatches were tolerated, so they did not completely prevent cleavage.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt: "some distal guide mismatches were tolerated",
            page: 4
          }
        ],
        difficulty: 2,
        verifierStatus: "PENDING"
      },
      chunks: [
        {
          id: "chunk-1",
          content:
            "Efficient cleavage required seed-region complementarity near the PAM, whereas some distal guide mismatches were tolerated.",
          page: 4
        }
      ],
      styleProfile: {
        assumedBackgroundLevel: "generalist"
      }
    });

    expect(result.status).toBe("PASSED");
  });

  it("does not over-reject MCQ stems that share source terminology without copying a sentence", async () => {
    const result = await verifyQuestion({
      question: {
        type: "MCQ",
        stem:
          "Which cleavage requirement best explains why distal guide mismatches were tolerated in the described system?",
        options: [
          "Seed-region complementarity near the PAM was preserved",
          "PAM recognition became unnecessary after guide binding",
          "Full-length guide matching was required in every position",
          "The system targeted RNA rather than DNA"
        ],
        answer: "Seed-region complementarity near the PAM was preserved",
        rationale:
          "The source identifies seed-region complementarity near the PAM as required while noting that distal guide mismatches could be tolerated.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt:
              "Efficient cleavage required seed-region complementarity near the PAM, whereas some distal guide mismatches were tolerated.",
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
            "Efficient cleavage required seed-region complementarity near the PAM, whereas some distal guide mismatches were tolerated.",
          page: 1
        }
      ],
      styleProfile: {
        assumedBackgroundLevel: "generalist"
      }
    });

    expect(result.status).toBe("PASSED");
  });

  it("does not over-reject short-answer stems that ask for explanation from source terms", async () => {
    const result = await verifyQuestion({
      question: {
        type: "SHORT_ANSWER",
        stem:
          "Explain how the source distinguishes seed-region complementarity from distal guide mismatches.",
        answer:
          "Seed-region complementarity near the PAM was required for efficient cleavage, while some distal guide mismatches were tolerated.",
        rationale:
          "The answer captures the source's contrast between a required seed-region feature and tolerated distal mismatches.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt:
              "Efficient cleavage required seed-region complementarity near the PAM, whereas some distal guide mismatches were tolerated.",
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
            "Efficient cleavage required seed-region complementarity near the PAM, whereas some distal guide mismatches were tolerated.",
          page: 1
        }
      ],
      styleProfile: {
        assumedBackgroundLevel: "generalist"
      }
    });

    expect(result.status).toBe("PASSED");
  });

  it("rejects unexplained non-universal abbreviations in learner-facing MCQ text", async () => {
    const result = await verifyQuestion({
      question: {
        type: "MCQ",
        stem: "Which diagnosis is associated with loss of elastic fibers in the papillary dermis?",
        options: [
          "MDE",
          "Anetoderma",
          "Cutis laxa",
          "Pseudoxanthoma elasticum"
        ],
        answer: "MDE",
        rationale:
          "The source describes MDE as involving loss of elastic fibers in the papillary dermis.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt:
              "Mid-dermal elastolysis (MDE) is characterized by selective loss of elastic fibers in the mid dermis.",
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
            "Mid-dermal elastolysis (MDE) is characterized by selective loss of elastic fibers in the mid dermis.",
          page: 1
        }
      ],
      styleProfile: {
        assumedBackgroundLevel: "generalist"
      }
    });

    expect(result.status).toBe("FAILED");
    expect(result.reason).toContain("MDE");
    expect(result.failureCodes).toEqual(expect.arrayContaining(["LOW_EDUCATIONAL_VALUE"]));
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it("allows a source-defined abbreviation when expanded on first use in the item", async () => {
    const result = await verifyQuestion({
      question: {
        type: "MCQ",
        stem:
          "Which finding best matches mid-dermal elastolysis (MDE) as described in the source?",
        options: [
          "Selective loss of elastic fibers in the mid dermis",
          "Diffuse collagen loss throughout the reticular dermis",
          "Epidermal blistering with full-thickness necrosis",
          "Subcutaneous calcification around blood vessels"
        ],
        answer: "Selective loss of elastic fibers in the mid dermis",
        rationale:
          "Mid-dermal elastolysis (MDE) is described as selective elastic-fiber loss in the mid dermis.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt:
              "Mid-dermal elastolysis (MDE) is characterized by selective loss of elastic fibers in the mid dermis.",
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
            "Mid-dermal elastolysis (MDE) is characterized by selective loss of elastic fibers in the mid dermis.",
          page: 1
        }
      ],
      styleProfile: {
        assumedBackgroundLevel: "generalist"
      }
    });

    expect(result.status).toBe("PASSED");
  });

  it("rejects convoluted differentiates/compared-to stem wording before LLM review", async () => {
    const result = await verifyQuestion({
      question: {
        type: "MCQ",
        stem:
          "Which of the following differentiates dermatological conditions that feature loss of elastic fibers compared to other conditions characterized by collagen loss?",
        options: [
          "Selective elastic-fiber loss in the mid dermis",
          "Diffuse collagen loss in all dermal layers",
          "Basement membrane thickening",
          "Subcutaneous fat necrosis"
        ],
        answer: "Selective elastic-fiber loss in the mid dermis",
        rationale:
          "The cited source supports selective elastic-fiber loss as the relevant distinguishing feature.",
        citations: [
          {
            chunkId: "chunk-1",
            excerpt:
              "Mid-dermal elastolysis is characterized by selective loss of elastic fibers in the mid dermis.",
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
            "Mid-dermal elastolysis is characterized by selective loss of elastic fibers in the mid dermis.",
          page: 1
        }
      ],
      styleProfile: {
        assumedBackgroundLevel: "generalist"
      }
    });

    expect(result.status).toBe("FAILED");
    expect(result.reason).toContain("differentiates");
    expect(result.failureCodes).toEqual(
      expect.arrayContaining(["LOW_EDUCATIONAL_VALUE", "AMBIGUOUS_QUESTION"])
    );
    expect(createCompletion).not.toHaveBeenCalled();
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
          "MRI remains the preferred and more sensitive imaging test for suspected occult spinal dysraphism even before 5 months of age.",
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
      expect.arrayContaining(["UNSUPPORTED_ANSWER"])
    );
    expect(result.failureCodes ?? []).not.toContain("INVALID_TRUE_FALSE");
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
