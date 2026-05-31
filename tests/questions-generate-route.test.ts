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
    },
    generationJob: {
      create: vi.fn()
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
import { prisma } from "@/lib/db/prisma";
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
    (prisma.document.findMany as any).mockResolvedValue([{ id: "doc-1", ownerId: "user-1", status: "READY" }]);
    (prisma.generationJob.create as any).mockResolvedValue({ id: "job-1", status: "PENDING" });
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

  it("queues TRUE_FALSE generation when the request uses the canonical questionType field", async () => {
    const request = new Request("http://localhost/api/questions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentIds: ["doc-1"],
        questionType: "TRUE_FALSE",
        difficulty: 3,
        count: 5
      })
    });

    const response = await POST(request);

    expect(response.status).toBe(202);
    expect(prisma.generationJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestedCount: 5,
        typeMix: { MCQ: 0, SHORT_ANSWER: 0, TRUE_FALSE: 5 }
      })
    });
  });

  it("queues TRUE_FALSE generation when the request uses a UI-style true/false value", async () => {
    const request = new Request("http://localhost/api/questions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentIds: ["doc-1"],
        type: "True/false",
        difficulty: 3,
        count: 2
      })
    });

    const response = await POST(request);

    expect(response.status).toBe(202);
    expect(prisma.generationJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestedCount: 2,
        typeMix: { MCQ: 0, SHORT_ANSWER: 0, TRUE_FALSE: 2 }
      })
    });
  });

  it("queues a mixed objective typeMix with MCQ and TRUE_FALSE counts", async () => {
    const request = new Request("http://localhost/api/questions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentIds: ["doc-1"],
        typeMix: { MCQ: 2, TRUE_FALSE: 3 },
        difficulty: 3,
        count: 5
      })
    });

    const response = await POST(request);

    expect(response.status).toBe(202);
    expect(prisma.generationJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestedCount: 5,
        typeMix: { MCQ: 2, SHORT_ANSWER: 0, TRUE_FALSE: 3 }
      })
    });
  });

  it("returns a clean error instead of defaulting to MCQ when the type is missing", async () => {
    const request = new Request("http://localhost/api/questions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentIds: ["doc-1"],
        difficulty: 3,
        count: 1
      })
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Choose Multiple choice, True/false, or both before generating questions."
    });
    expect(prisma.generationJob.create).not.toHaveBeenCalled();
  });

  it("returns a clean error instead of defaulting to MCQ when the type is unknown", async () => {
    const request = new Request("http://localhost/api/questions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentIds: ["doc-1"],
        questionType: "ESSAY",
        difficulty: 3,
        count: 1
      })
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Choose Multiple choice, True/false, or both before generating questions."
    });
    expect(prisma.generationJob.create).not.toHaveBeenCalled();
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
