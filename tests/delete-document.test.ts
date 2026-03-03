import { describe, expect, it, vi, beforeEach } from "vitest";

// Define mocks *inside* the mock factories (because vi.mock is hoisted)
vi.mock("@/lib/db/prisma", () => {
  return {
    prisma: {
      document: {
        findUnique: vi.fn(),
        delete: vi.fn()
      }
    }
  };
});

vi.mock("@/lib/storage/storage", () => {
  return {
    deleteFile: vi.fn()
  };
});

import { prisma } from "@/lib/db/prisma";
import { deleteFile } from "@/lib/storage/storage";
import { deleteDocument } from "@/lib/documents/delete";

describe("deleteDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes document and file", async () => {
    (prisma.document.findUnique as any).mockResolvedValue({
      id: "doc1",
      ownerId: "user1",
      storageKey: "path"
    });
    (prisma.document.delete as any).mockResolvedValue({ id: "doc1" });
    (deleteFile as any).mockResolvedValue(undefined);

    const result = await deleteDocument("doc1", "user1");

    expect(result).toBe(true);
    expect(prisma.document.delete).toHaveBeenCalled();
    expect(deleteFile).toHaveBeenCalledWith("path");
  });
});