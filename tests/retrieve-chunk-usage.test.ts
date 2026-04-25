import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    chunkUsage: {
      groupBy: vi.fn()
    }
  }
}));

vi.mock("@/lib/llm/embeddings", () => ({
  embedText: vi.fn()
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

import { applyChunkUsagePenalty } from "@/lib/retrieval/retrieve";

describe("chunk usage penalty", () => {
  it("applies the expected multiplicative decay for reused chunks", () => {
    expect(applyChunkUsagePenalty(0.8, 0)).toBe(0.8);
    expect(applyChunkUsagePenalty(0.8, 1)).toBe(0.4);
    expect(applyChunkUsagePenalty(0.8, 3)).toBe(0.1);
  });
});
