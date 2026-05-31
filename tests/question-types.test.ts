import { describe, expect, it } from "vitest";
import { normalizeQuestionType } from "@/lib/constants/question-types";

describe("question type mapping", () => {
  it("maps UI true/false values to canonical TRUE_FALSE", () => {
    expect(normalizeQuestionType("TRUE_FALSE")).toBe("TRUE_FALSE");
    expect(normalizeQuestionType("True/false")).toBe("TRUE_FALSE");
    expect(normalizeQuestionType("true false")).toBe("TRUE_FALSE");
    expect(normalizeQuestionType("TF")).toBe("TRUE_FALSE");
  });

  it("maps multiple-choice aliases to canonical MCQ", () => {
    expect(normalizeQuestionType("MCQ")).toBe("MCQ");
    expect(normalizeQuestionType("Multiple choice")).toBe("MCQ");
  });

  it("rejects unknown question types", () => {
    expect(normalizeQuestionType("ESSAY")).toBeNull();
    expect(normalizeQuestionType(null)).toBeNull();
  });
});
