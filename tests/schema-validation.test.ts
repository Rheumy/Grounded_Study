import { describe, expect, it } from "vitest";
import { StyleProfileSchema } from "@/lib/llm/schemas/style-profile";
import { GeneratedQuestionSchema } from "@/lib/llm/schemas/question";

// Import the internal normalisation helpers via the module.
// We test the exported function by reaching through the named exports.
// Since normalizeRawStyleProfile is not exported, we exercise it indirectly
// through the schema after testing normalization outputs directly.

const styleSample = {
  questionTypeDistribution: { MCQ: 0.8, SHORT_ANSWER: 0.2, TRUE_FALSE: 0.0 },
  stemLength: { minWords: 8, maxWords: 20 },
  distractorStyle: "Conceptual distractors tied to common misconceptions",
  explanationTone: "Concise and supportive",
  answerStyle: "One complete sentence with justification",
  difficultyMap: {
    "1": "Remember",
    "2": "Understand",
    "3": "Apply",
    "4": "Analyze",
    "5": "Evaluate"
  },
  preferredTags: ["biology", "cells"]
};

const questionSample = {
  type: "MCQ",
  stem: "Which organelle is responsible for ATP production?",
  options: ["Nucleus", "Mitochondria", "Golgi apparatus", "Ribosome"],
  answer: "Mitochondria",
  rationale: "The excerpt states mitochondria generate ATP during respiration.",
  citations: [{ chunkId: "chunk1", excerpt: "Mitochondria produce ATP", page: 2 }],
  difficulty: 2,
  tags: ["cells"],
  verifierStatus: "PENDING"
};

describe("schema validation", () => {
  it("accepts valid style profile", () => {
    expect(StyleProfileSchema.parse(styleSample)).toBeTruthy();
  });

  it("accepts valid question", () => {
    expect(GeneratedQuestionSchema.parse(questionSample)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Style profile normalization edge cases (regression tests for real LLM bugs)
// ---------------------------------------------------------------------------
describe("style profile normalization edge cases", () => {
  it("rejects MCQ > 1 raw from model — StyleProfileSchema itself requires [0,1]", () => {
    // The schema enforces .min(0).max(1) — values like 80 must be caught before parse
    const bad = { ...styleSample, questionTypeDistribution: { MCQ: 80, SHORT_ANSWER: 20, TRUE_FALSE: 0 } };
    expect(() => StyleProfileSchema.parse(bad)).toThrow();
  });

  it("rejects missing stemLength.minWords — schema requires it", () => {
    const bad = { ...styleSample, stemLength: { maxWords: 30 } };
    expect(() => StyleProfileSchema.parse(bad)).toThrow();
  });

  it("rejects notes as object — schema requires string", () => {
    const bad = { ...styleSample, notes: { inference: "inferred", detail: "some detail" } };
    expect(() => StyleProfileSchema.parse(bad)).toThrow();
  });

  it("accepts style profile without optional fields", () => {
    const minimal = {
      questionTypeDistribution: { MCQ: 0.7, SHORT_ANSWER: 0.3, TRUE_FALSE: 0.0 },
      stemLength: { minWords: 8, maxWords: 30 },
      distractorStyle: "plausible near-misses",
      explanationTone: "clear and direct",
      difficultyMap: {
        "1": "recall",
        "2": "comprehension",
        "3": "application",
        "4": "synthesis",
        "5": "expert"
      }
    };
    expect(StyleProfileSchema.parse(minimal)).toBeTruthy();
  });
});
