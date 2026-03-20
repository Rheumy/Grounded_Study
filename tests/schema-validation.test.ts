import { describe, expect, it } from "vitest";
import { StyleProfileSchema } from "@/lib/llm/schemas/style-profile";
import { GeneratedQuestionSchema } from "@/lib/llm/schemas/question";

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
