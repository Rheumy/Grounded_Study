import { describe, expect, it } from "vitest";
import { PRESET_DISPLAY_ORDER, PRESETS_IN_DISPLAY_ORDER, resolvePreset } from "@/lib/llm/presets";

describe("question style presets", () => {
  it("resolves the standard MCQ preset to an MCQ-only style profile", () => {
    const preset = resolvePreset("standard_mcq");

    expect(preset?.styleProfile.questionTypeDistribution.MCQ).toBe(1);
    expect(preset?.styleProfile.questionTypeDistribution.SHORT_ANSWER).toBe(0);
    expect(preset?.styleProfile.questionTypeDistribution.TRUE_FALSE).toBe(0);
  });

  it("keeps the short-answer preset exported but out of beta display lists", () => {
    expect(resolvePreset("standard_short_answer")?.key).toBe("standard_short_answer");
    expect(PRESET_DISPLAY_ORDER).toEqual(["standard_mcq", "standard_true_false"]);
    expect(PRESETS_IN_DISPLAY_ORDER.map((preset) => preset.key)).toEqual([
      "standard_mcq",
      "standard_true_false"
    ]);
  });
});
