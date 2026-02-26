import { describe, expect, it, vi } from "vitest";
import { deleteDocument } from "@/lib/documents/delete";

const mockFind = vi.fn();
const mockDelete = vi.fn();
const mockDeleteFile = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    document: {
      findUnique: mockFind,
      delete: mockDelete
    }
  }
}));

vi.mock("@/lib/storage/storage", () => ({
  deleteFile: mockDeleteFile
}));

describe("deleteDocument", () => {
  it("deletes document and file", async () => {
    mockFind.mockResolvedValue({ id: "doc1", ownerId: "user1", storageKey: "path" });
    mockDelete.mockResolvedValue({ id: "doc1" });
    mockDeleteFile.mockResolvedValue(undefined);

    const result = await deleteDocument("doc1", "user1");
    expect(result).toBe(true);
    expect(mockDelete).toHaveBeenCalled();
    expect(mockDeleteFile).toHaveBeenCalledWith("path");
  });
});
