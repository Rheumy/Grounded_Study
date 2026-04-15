import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveGenerationCaps } from "@/lib/billing/generation-limits";

describe("generation limits", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses free/pro defaults and clamps the absolute cap to 100", () => {
    vi.stubEnv("FREE_MAX_GENERATE_COUNT", "25");
    vi.stubEnv("PRO_MAX_GENERATE_COUNT", "150");
    vi.stubEnv("ABSOLUTE_MAX_GENERATE_COUNT", "300");

    const freeCaps = resolveGenerationCaps("FREE");
    const proCaps = resolveGenerationCaps("PRO");

    expect(freeCaps.planMaxCount).toBe(25);
    expect(proCaps.planMaxCount).toBe(100);
    expect(proCaps.absoluteMaxCount).toBe(100);
  });

  it("keeps the pro cap at least as high as the free cap", () => {
    vi.stubEnv("FREE_MAX_GENERATE_COUNT", "40");
    vi.stubEnv("PRO_MAX_GENERATE_COUNT", "30");

    const freeCaps = resolveGenerationCaps("FREE");
    const proCaps = resolveGenerationCaps("PRO");

    expect(freeCaps.planMaxCount).toBe(40);
    expect(proCaps.planMaxCount).toBe(40);
  });
});
