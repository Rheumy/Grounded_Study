import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-user-api", () => ({
  requireUserApi: vi.fn()
}));

vi.mock("@/lib/jobs/queue", () => ({
  claimGenerationJobForUser: vi.fn()
}));

vi.mock("@/lib/jobs/processor", () => ({
  processGenerationJob: vi.fn()
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

import { requireUserApi } from "@/lib/auth/require-user-api";
import { claimGenerationJobForUser } from "@/lib/jobs/queue";
import { processGenerationJob } from "@/lib/jobs/processor";
import { POST } from "@/app/api/questions/generate/process/route";

describe("generate questions immediate process route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireUserApi as any).mockResolvedValue({ id: "user-1" });
  });

  it("requires authentication", async () => {
    (requireUserApi as any).mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/questions/generate/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: "job-1" })
      })
    );

    expect(response.status).toBe(401);
    expect(claimGenerationJobForUser).not.toHaveBeenCalled();
  });

  it("claims and processes the authenticated user's pending job", async () => {
    (claimGenerationJobForUser as any).mockResolvedValue({ id: "job-1", userId: "user-1" });
    (processGenerationJob as any).mockResolvedValue(undefined);

    const response = await POST(
      new Request("http://localhost/api/questions/generate/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: "job-1" })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, claimed: true });
    expect(claimGenerationJobForUser).toHaveBeenCalledWith({
      jobId: "job-1",
      userId: "user-1"
    });
    expect(processGenerationJob).toHaveBeenCalledWith("job-1", {
      processingSource: "immediate"
    });
  });

  it("returns safely when the job is already processing or completed", async () => {
    (claimGenerationJobForUser as any).mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/questions/generate/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: "job-1" })
      })
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true, claimed: false });
    expect(processGenerationJob).not.toHaveBeenCalled();
  });

  it("does not fail the request when immediate processing throws", async () => {
    (claimGenerationJobForUser as any).mockResolvedValue({ id: "job-1", userId: "user-1" });
    (processGenerationJob as any).mockRejectedValue(new Error("Temporary model outage"));

    const response = await POST(
      new Request("http://localhost/api/questions/generate/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: "job-1" })
      })
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: false, claimed: true });
  });
});
