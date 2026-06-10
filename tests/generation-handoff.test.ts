import { describe, expect, it } from "vitest";
import {
  buildGenerationHandoffKey,
  readGenerationHandoffJobId,
  writeGenerationHandoffJobId
} from "@/lib/generation/handoff";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("generation handoff idempotency", () => {
  it("builds the same key for the same upload handoff regardless of document order", () => {
    const first = buildGenerationHandoffKey({
      documentIds: ["doc-2", "doc-1"],
      questionMix: "MIXED",
      count: 10,
      difficulty: 3
    });
    const second = buildGenerationHandoffKey({
      documentIds: ["doc-1", "doc-2", "doc-1"],
      questionMix: "MIXED",
      count: 10,
      difficulty: 3
    });

    expect(first).toBe(second);
  });

  it("returns the existing job id when the same handoff is revisited", () => {
    const storage = new MemoryStorage();
    const key = buildGenerationHandoffKey({
      documentIds: ["doc-1"],
      questionMix: "MCQ",
      count: 10,
      difficulty: 3
    });

    writeGenerationHandoffJobId(storage, key, "job-1");

    expect(readGenerationHandoffJobId(storage, key)).toBe("job-1");
  });

  it("does not reuse a job id for a different target count", () => {
    const storage = new MemoryStorage();
    const originalKey = buildGenerationHandoffKey({
      documentIds: ["doc-1"],
      questionMix: "MCQ",
      count: 10,
      difficulty: 3
    });
    const differentCountKey = buildGenerationHandoffKey({
      documentIds: ["doc-1"],
      questionMix: "MCQ",
      count: 5,
      difficulty: 3
    });

    writeGenerationHandoffJobId(storage, originalKey, "job-1");

    expect(readGenerationHandoffJobId(storage, differentCountKey)).toBeNull();
  });
});
