import { describe, expect, it } from "vitest";
import { objectiveAnswersMatch } from "@/lib/questions/objective-answer";

describe("objective answer comparison", () => {
  it("marks TRUE_FALSE selected True against stored True", () => {
    expect(
      objectiveAnswersMatch({
        selectedAnswer: "True",
        storedAnswer: "True",
        questionType: "TRUE_FALSE"
      })
    ).toBe(true);
  });

  it("marks TRUE_FALSE selected False against stored False", () => {
    expect(
      objectiveAnswersMatch({
        selectedAnswer: "False",
        storedAnswer: "False",
        questionType: "TRUE_FALSE"
      })
    ).toBe(true);
  });

  it("normalizes harmless whitespace and casing for MCQ answers", () => {
    expect(
      objectiveAnswersMatch({
        selectedAnswer: "  Seed-region complementarity near the PAM  ",
        storedAnswer: "seed-region complementarity near the pam",
        questionType: "MCQ"
      })
    ).toBe(true);
  });
});
