import { describe, expect, it, vi, beforeEach } from "vitest";

// Define mocks *inside* the mock factories (because vi.mock is hoisted)
vi.mock("@/lib/db/prisma", () => {
  return {
    prisma: {
      $transaction: vi.fn(),
      chunkUsage: {
        findMany: vi.fn(),
        deleteMany: vi.fn()
      },
      document: {
        findUnique: vi.fn(),
        count: vi.fn(),
        delete: vi.fn()
      },
      documentChunk: {
        findMany: vi.fn()
      },
      question: {
        findMany: vi.fn(),
        updateMany: vi.fn()
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
    (prisma.chunkUsage.deleteMany as any).mockResolvedValue({ count: 0 });
    (prisma.$transaction as any).mockImplementation(async (callback: any) => callback(prisma));
    (deleteFile as any).mockResolvedValue(undefined);

    const result = await deleteDocument("doc1", "user1");

    expect(result).toEqual({ deleted: true, archivedQuestionCount: 0 });
    expect(prisma.chunkUsage.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user1",
        documentId: "doc1"
      }
    });
    expect(prisma.document.delete).toHaveBeenCalledWith({ where: { id: "doc1" } });
    expect(deleteFile).toHaveBeenCalledWith("path");
  });

  it("refuses to delete another user's document", async () => {
    (prisma.document.findUnique as any).mockResolvedValue({
      id: "doc1",
      ownerId: "user2",
      storageKey: "path"
    });

    await expect(deleteDocument("doc1", "user1")).rejects.toThrow("Document not found");
    expect(prisma.document.delete).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("archives associated generated questions when requested", async () => {
    (prisma.document.findUnique as any).mockResolvedValue({
      id: "doc1",
      ownerId: "user1",
      storageKey: "path"
    });
    (prisma.chunkUsage.findMany as any).mockResolvedValue([
      { questionId: "question-1" },
      { questionId: "question-2" }
    ]);
    (prisma.documentChunk.findMany as any).mockResolvedValue([]);
    (prisma.document.count as any).mockResolvedValue(1);
    (prisma.question.findMany as any).mockResolvedValue([]);
    (prisma.chunkUsage.deleteMany as any).mockResolvedValue({ count: 2 });
    (prisma.question.updateMany as any).mockResolvedValue({ count: 2 });
    (prisma.document.delete as any).mockResolvedValue({ id: "doc1" });
    (prisma.$transaction as any).mockImplementation(async (callback: any) => callback(prisma));
    (deleteFile as any).mockResolvedValue(undefined);

    const result = await deleteDocument("doc1", "user1", { deleteAssociatedQuestions: true });

    expect(prisma.chunkUsage.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user1",
        documentId: "doc1"
      },
      select: {
        questionId: true
      },
      distinct: ["questionId"]
    });
    expect(prisma.question.updateMany).toHaveBeenCalledWith({
      where: {
        ownerId: "user1",
        id: {
          in: ["question-1", "question-2"]
        },
        verifierStatus: "PASSED"
      },
      data: {
        verifierStatus: "FAILED"
      }
    });
    expect(result).toEqual({ deleted: true, archivedQuestionCount: 2 });
  });

  it("archives questions linked through citation chunk IDs when ChunkUsage is missing", async () => {
    (prisma.document.findUnique as any).mockResolvedValue({
      id: "doc1",
      ownerId: "user1",
      storageKey: "path"
    });
    (prisma.chunkUsage.findMany as any).mockResolvedValue([]);
    (prisma.documentChunk.findMany as any).mockResolvedValue([{ id: "chunk-1" }]);
    (prisma.document.count as any).mockResolvedValue(1);
    (prisma.question.findMany as any).mockResolvedValue([
      {
        id: "question-1",
        citationsJson: [{ chunkId: "chunk-1", excerpt: "Evidence" }]
      },
      {
        id: "question-2",
        citationsJson: [{ chunkId: "other-chunk", excerpt: "Other" }]
      }
    ]);
    (prisma.chunkUsage.deleteMany as any).mockResolvedValue({ count: 0 });
    (prisma.question.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.document.delete as any).mockResolvedValue({ id: "doc1" });
    (prisma.$transaction as any).mockImplementation(async (callback: any) => callback(prisma));
    (deleteFile as any).mockResolvedValue(undefined);

    const result = await deleteDocument("doc1", "user1", { deleteAssociatedQuestions: true });

    expect(prisma.question.updateMany).toHaveBeenCalledWith({
      where: {
        ownerId: "user1",
        id: {
          in: ["question-1"]
        },
        verifierStatus: "PASSED"
      },
      data: {
        verifierStatus: "FAILED"
      }
    });
    expect(result).toEqual({ deleted: true, archivedQuestionCount: 1 });
  });

  it("does not archive unrelated questions when other documents remain", async () => {
    (prisma.document.findUnique as any).mockResolvedValue({
      id: "doc1",
      ownerId: "user1",
      storageKey: "path"
    });
    (prisma.chunkUsage.findMany as any).mockResolvedValue([]);
    (prisma.documentChunk.findMany as any).mockResolvedValue([{ id: "chunk-1" }]);
    (prisma.document.count as any).mockResolvedValue(1);
    (prisma.question.findMany as any).mockResolvedValue([
      {
        id: "question-2",
        citationsJson: [{ chunkId: "other-chunk", excerpt: "Other" }]
      }
    ]);
    (prisma.chunkUsage.deleteMany as any).mockResolvedValue({ count: 0 });
    (prisma.document.delete as any).mockResolvedValue({ id: "doc1" });
    (prisma.$transaction as any).mockImplementation(async (callback: any) => callback(prisma));
    (deleteFile as any).mockResolvedValue(undefined);

    const result = await deleteDocument("doc1", "user1", { deleteAssociatedQuestions: true });

    expect(prisma.question.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ deleted: true, archivedQuestionCount: 0 });
  });

  it("does not archive another user's questions", async () => {
    (prisma.document.findUnique as any).mockResolvedValue({
      id: "doc1",
      ownerId: "user1",
      storageKey: "path"
    });
    (prisma.chunkUsage.findMany as any).mockResolvedValue([{ questionId: "question-1" }]);
    (prisma.documentChunk.findMany as any).mockResolvedValue([{ id: "chunk-1" }]);
    (prisma.document.count as any).mockResolvedValue(1);
    (prisma.question.findMany as any).mockResolvedValue([
      {
        id: "question-1",
        citationsJson: [{ chunkId: "chunk-1", excerpt: "Evidence" }]
      }
    ]);
    (prisma.chunkUsage.deleteMany as any).mockResolvedValue({ count: 1 });
    (prisma.question.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.document.delete as any).mockResolvedValue({ id: "doc1" });
    (prisma.$transaction as any).mockImplementation(async (callback: any) => callback(prisma));
    (deleteFile as any).mockResolvedValue(undefined);

    await deleteDocument("doc1", "user1", { deleteAssociatedQuestions: true });

    expect(prisma.question.findMany).toHaveBeenCalledWith({
      where: {
        ownerId: "user1",
        verifierStatus: "PASSED"
      },
      select: {
        id: true,
        citationsJson: true
      }
    });
    expect(prisma.question.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerId: "user1"
        })
      })
    );
  });

  it("identifies linked questions before deleting the document and chunks", async () => {
    const events: string[] = [];
    (prisma.document.findUnique as any).mockResolvedValue({
      id: "doc1",
      ownerId: "user1",
      storageKey: "path"
    });
    (prisma.chunkUsage.findMany as any).mockImplementation(async () => {
      events.push("chunkUsage.findMany");
      return [{ questionId: "question-1" }];
    });
    (prisma.documentChunk.findMany as any).mockImplementation(async () => {
      events.push("documentChunk.findMany");
      return [{ id: "chunk-1" }];
    });
    (prisma.document.count as any).mockResolvedValue(1);
    (prisma.question.findMany as any).mockResolvedValue([]);
    (prisma.chunkUsage.deleteMany as any).mockResolvedValue({ count: 1 });
    (prisma.question.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.document.delete as any).mockImplementation(async () => {
      events.push("document.delete");
      return { id: "doc1" };
    });
    (prisma.$transaction as any).mockImplementation(async (callback: any) => callback(prisma));
    (deleteFile as any).mockResolvedValue(undefined);

    await deleteDocument("doc1", "user1", { deleteAssociatedQuestions: true });

    expect(events.indexOf("chunkUsage.findMany")).toBeLessThan(events.indexOf("document.delete"));
    expect(events.indexOf("documentChunk.findMany")).toBeLessThan(events.indexOf("document.delete"));
  });

  it("archives orphaned active questions when deleting the user's last document", async () => {
    (prisma.document.findUnique as any).mockResolvedValue({
      id: "doc1",
      ownerId: "user1",
      storageKey: "path"
    });
    (prisma.chunkUsage.findMany as any).mockResolvedValue([]);
    (prisma.documentChunk.findMany as any)
      .mockResolvedValueOnce([{ id: "chunk-1" }])
      .mockResolvedValueOnce([]);
    (prisma.document.count as any).mockResolvedValue(0);
    (prisma.question.findMany as any).mockResolvedValue([
      {
        id: "question-1",
        citationsJson: [{ chunkId: "chunk-1", excerpt: "Evidence" }]
      },
      {
        id: "question-2",
        citationsJson: []
      }
    ]);
    (prisma.chunkUsage.deleteMany as any).mockResolvedValue({ count: 0 });
    (prisma.question.updateMany as any).mockResolvedValue({ count: 2 });
    (prisma.document.delete as any).mockResolvedValue({ id: "doc1" });
    (prisma.$transaction as any).mockImplementation(async (callback: any) => callback(prisma));
    (deleteFile as any).mockResolvedValue(undefined);

    const result = await deleteDocument("doc1", "user1", { deleteAssociatedQuestions: true });

    expect(prisma.question.updateMany).toHaveBeenCalledWith({
      where: {
        ownerId: "user1",
        id: {
          in: ["question-1", "question-2"]
        },
        verifierStatus: "PASSED"
      },
      data: {
        verifierStatus: "FAILED"
      }
    });
    expect(result).toEqual({ deleted: true, archivedQuestionCount: 2 });
  });
});
