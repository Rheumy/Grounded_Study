import { describe, expect, it } from "vitest";
import { resolvePreset } from "@/lib/llm/presets";

describe("question style presets", () => {
  it("resolves the standard MCQ preset to an MCQ-only style profile", () => {
    const preset = resolvePreset("standard_mcq");

    expect(preset?.styleProfile.questionTypeDistribution.MCQ).toBe(1);
    expect(preset?.styleProfile.questionTypeDistribution.SHORT_ANSWER).toBe(0);
    expect(preset?.styleProfile.questionTypeDistribution.TRUE_FALSE).toBe(0);
  });
});
