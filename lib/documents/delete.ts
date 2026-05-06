import { prisma } from "@/lib/db/prisma";
import { deleteFile } from "@/lib/storage/storage";

type CitationJson = unknown;

function extractCitationChunkIds(citationsJson: CitationJson): string[] {
  if (!Array.isArray(citationsJson)) return [];

  return Array.from(
    new Set(
      citationsJson
        .map((citation) => {
          if (!citation || typeof citation !== "object") return null;
          const citationRecord = citation as { chunkId?: unknown; chunk_id?: unknown };
          const chunkId = citationRecord.chunkId ?? citationRecord.chunk_id;
          return typeof chunkId === "string" && chunkId.trim().length > 0 ? chunkId.trim() : null;
        })
        .filter((chunkId): chunkId is string => Boolean(chunkId))
    )
  );
}

export async function deleteDocument(
  documentId: string,
  ownerId: string,
  options: { deleteAssociatedQuestions?: boolean } = {}
) {
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document || document.ownerId !== ownerId) {
    throw new Error("Document not found");
  }

  const archivedQuestionCount = await prisma.$transaction(async (tx) => {
    const linkedQuestionIds = new Set<string>();

    if (options.deleteAssociatedQuestions) {
      const linkedQuestions = await tx.chunkUsage.findMany({
        where: {
          userId: ownerId,
          documentId
        },
        select: {
          questionId: true
        },
        distinct: ["questionId"]
      });
      const documentChunks = await tx.documentChunk.findMany({
        where: {
          documentId
        },
        select: {
          id: true
        }
      });
      const remainingDocumentCount = await tx.document.count({
        where: {
          ownerId,
          id: {
            not: documentId
          }
        }
      });
      const activeQuestions = await tx.question.findMany({
        where: {
          ownerId,
          verifierStatus: "PASSED"
        },
        select: {
          id: true,
          citationsJson: true
        }
      });

      for (const row of linkedQuestions) {
        if (row.questionId) linkedQuestionIds.add(row.questionId);
      }

      const deletingChunkIds = new Set(documentChunks.map((chunk) => chunk.id));
      const citedChunkIds = new Set<string>();

      for (const question of activeQuestions) {
        const citationChunkIds = extractCitationChunkIds(question.citationsJson);
        citationChunkIds.forEach((chunkId) => citedChunkIds.add(chunkId));

        if (citationChunkIds.some((chunkId) => deletingChunkIds.has(chunkId))) {
          linkedQuestionIds.add(question.id);
        }
      }

      if (remainingDocumentCount === 0) {
        const existingCitedChunks =
          citedChunkIds.size > 0
            ? await tx.documentChunk.findMany({
                where: {
                  id: {
                    in: Array.from(citedChunkIds)
                  },
                  documentId: {
                    not: documentId
                  }
                },
                select: {
                  id: true
                }
              })
            : [];
        const validRemainingChunkIds = new Set(existingCitedChunks.map((chunk) => chunk.id));

        for (const question of activeQuestions) {
          const citationChunkIds = extractCitationChunkIds(question.citationsJson);
          const hasValidRemainingSource = citationChunkIds.some((chunkId) => validRemainingChunkIds.has(chunkId));
          if (!hasValidRemainingSource) {
            linkedQuestionIds.add(question.id);
          }
        }
      }
    }

    await tx.chunkUsage.deleteMany({
      where: {
        userId: ownerId,
        documentId
      }
    });

    const archivedQuestions =
      linkedQuestionIds.size > 0
        ? await tx.question.updateMany({
            where: {
              ownerId,
              id: {
                in: Array.from(linkedQuestionIds)
              },
              verifierStatus: "PASSED"
            },
            data: {
              verifierStatus: "FAILED"
            }
          })
        : { count: 0 };

    await tx.document.delete({ where: { id: documentId } });

    return archivedQuestions.count;
  });

  await deleteFile(document.storageKey);
  return {
    deleted: true,
    archivedQuestionCount
  };
}
