import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveUploadCaps, isSplitCandidate } from "@/lib/billing/upload-limits";
import { resolveDocumentSourceType } from "@/lib/documents/source-type";

describe("upload limits", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses free/pro defaults and clamps the absolute cap to 250 MB", () => {
    vi.stubEnv("FREE_MAX_UPLOAD_MB", "20");
    vi.stubEnv("PRO_MAX_UPLOAD_MB", "300");
    vi.stubEnv("ABSOLUTE_MAX_UPLOAD_MB", "400");

    const freeCaps = resolveUploadCaps("FREE");
    const proCaps = resolveUploadCaps("PRO");

    expect(freeCaps.planMaxMb).toBe(20);
    expect(proCaps.planMaxMb).toBe(250);
    expect(proCaps.absoluteMaxMb).toBe(250);
  });

  it("falls back to the legacy MAX_UPLOAD_MB env for free uploads", () => {
    vi.stubEnv("MAX_UPLOAD_MB", "35");

    const freeCaps = resolveUploadCaps("FREE");
    const proCaps = resolveUploadCaps("PRO");

    expect(freeCaps.planMaxMb).toBe(35);
    expect(proCaps.planMaxMb).toBe(100);
  });

  it("flags oversized PDFs within the platform cap as future split candidates", () => {
    expect(
      isSplitCandidate({
        kind: "pdf",
        sizeBytes: 25 * 1024 * 1024,
        planMaxMb: 20,
        absoluteMaxMb: 250
      })
    ).toBe(true);

    expect(
      isSplitCandidate({
        kind: "pdf",
        sizeBytes: 260 * 1024 * 1024,
        planMaxMb: 100,
        absoluteMaxMb: 250
      })
    ).toBe(false);

    expect(
      isSplitCandidate({
        kind: "docx",
        sizeBytes: 25 * 1024 * 1024,
        planMaxMb: 20,
        absoluteMaxMb: 250
      })
    ).toBe(false);
  });
});

describe("document source type mapping", () => {
  it("persists docx uploads as TEXT instead of IMAGE", () => {
    expect(resolveDocumentSourceType("docx")).toBe("TEXT");
    expect(resolveDocumentSourceType("pdf")).toBe("PDF");
    expect(resolveDocumentSourceType("image")).toBe("IMAGE");
  });
});
