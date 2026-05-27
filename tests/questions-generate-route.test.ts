import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-user-api", () => ({
  requireUserApi: vi.fn()
}));

vi.mock("@/lib/billing/generation-limits", () => ({
  resolveUserGenerationCaps: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    document: {
      findMany: vi.fn()
    }
  }
}));

vi.mock("@/lib/llm/generate", () => ({
  generateQuestions: vi.fn()
}));

vi.mock("@/lib/billing/usage", () => ({
  enforceQuestionLimit: vi.fn(),
  incrementUsage: vi.fn()
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

import { requireUserApi } from "@/lib/auth/require-user-api";
import { resolveUserGenerationCaps } from "@/lib/billing/generation-limits";
import { POST } from "@/app/api/questions/generate/route";

describe("generate questions route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireUserApi as any).mockResolvedValue({ id: "user-1" });
    (resolveUserGenerationCaps as any).mockResolvedValue({
      plan: "FREE",
      freeMaxCount: 25,
      proMaxCount: 100,
      absoluteMaxCount: 100,
      planMaxCount: 25
    });
  });

  it("returns 400 when both presetKey and styleProfileId are provided", async () => {
    const request = new Request("http://localhost/api/questions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentIds: ["doc-1"],
        presetKey: "standard_mcq",
        styleProfileId: "profile-1",
        difficulty: 3,
        count: 1
      })
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Provide either a preset or a saved profile, not both"
    });
  });

  it("blocks explicit short-answer generation during beta", async () => {
    const request = new Request("http://localhost/api/questions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentIds: ["doc-1"],
        typeMix: { MCQ: 0, SHORT_ANSWER: 1, TRUE_FALSE: 0 },
        difficulty: 3,
        count: 1
      })
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Short-answer questions are not available in this beta yet."
    });
  });

  it("blocks the short-answer preset during beta", async () => {
    const request = new Request("http://localhost/api/questions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentIds: ["doc-1"],
        presetKey: "standard_short_answer",
        difficulty: 3,
        count: 1
      })
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Short-answer questions are not available in this beta yet."
    });
  });
});
