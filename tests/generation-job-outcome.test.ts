import { describe, expect, it } from "vitest";
import {
  buildGenerationSummary,
  canPracticeGeneratedQuestions,
  getGenerationFailedCount,
  getGenerationOutcome
} from "@/lib/generation/job-outcome";

describe("generation job outcome", () => {
  it("reports zero-saved failures cleanly", () => {
    expect(
      getGenerationOutcome({ status: "FAILED", requestedCount: 5, passedCount: 0 })
    ).toBe("FAILED_NONE");
    expect(
      buildGenerationSummary({ requestedCount: 5, passedCount: 0 })
    ).toBe("We couldn't generate supported questions from this material. Try a different document or fewer questions.");
  });

  it("reports partial success instead of failure when at least one question was saved", () => {
    expect(
      getGenerationOutcome({ status: "COMPLETED", requestedCount: 5, passedCount: 1 })
    ).toBe("COMPLETED_PARTIAL");
    expect(getGenerationFailedCount({ requestedCount: 5, passedCount: 1 })).toBe(4);
    expect(
      buildGenerationSummary({ requestedCount: 5, passedCount: 1 })
    ).toBe("Generated 1 of 5 questions. Some questions could not be generated from the available evidence.");
  });

  it("reports full success when all requested questions were saved", () => {
    expect(
      getGenerationOutcome({ status: "COMPLETED", requestedCount: 5, passedCount: 5 })
    ).toBe("COMPLETED_FULL");
    expect(getGenerationFailedCount({ requestedCount: 5, passedCount: 5 })).toBe(0);
    expect(buildGenerationSummary({ requestedCount: 5, passedCount: 5 })).toBe("Generated 5 questions.");
  });

  it("shows practice actions only when at least one question was saved", () => {
    expect(canPracticeGeneratedQuestions({ passedCount: 0 })).toBe(false);
    expect(canPracticeGeneratedQuestions({ passedCount: 1 })).toBe(true);
  });
});
