import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/ingestion/chunk";

const sample = Array.from({ length: 20 }, (_, idx) => `Sentence ${idx + 1}.`).join("\n");

describe("chunkText", () => {
  it("creates overlapping chunks", () => {
    const chunks = chunkText(sample, 60, 10);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toContain("Sentence 1");
    expect(chunks[chunks.length - 1]).toContain("Sentence 20");
  });
});
