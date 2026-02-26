import { describe, expect, it } from "vitest";
import { canTransition, transition } from "@/lib/jobs/status";

describe("job transitions", () => {
  it("allows queued -> running", () => {
    expect(canTransition("QUEUED", "RUNNING")).toBe(true);
  });

  it("blocks completed -> running", () => {
    expect(canTransition("COMPLETED", "RUNNING")).toBe(false);
    expect(() => transition("COMPLETED", "RUNNING")).toThrow();
  });
});
