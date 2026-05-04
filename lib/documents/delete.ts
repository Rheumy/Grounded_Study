import { prisma } from "@/lib/db/prisma";
import { deleteFile } from "@/lib/storage/storage";

export async function deleteDocument(
  documentId: string,
  ownerId: string,
  options: { deleteAssociatedQuestions?: boolean } = {}
) {
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document || document.ownerId !== ownerId) {
    throw new Error("Document not found");
  }

  const linkedQuestions = options.deleteAssociatedQuestions
    ? await prisma.chunkUsage.findMany({
        where: {
          userId: ownerId,
          documentId
        },
        select: {
          questionId: true
        },
        distinct: ["questionId"]
      })
    : [];

  const linkedQuestionIds = linkedQuestions.map((row) => row.questionId).filter(Boolean);

  const archivedQuestionCount = await prisma.$transaction(async (tx) => {
    await tx.chunkUsage.deleteMany({
      where: {
        userId: ownerId,
        documentId
      }
    });

    const archivedQuestions =
      linkedQuestionIds.length > 0
        ? await tx.question.updateMany({
            where: {
              ownerId,
              id: {
                in: linkedQuestionIds
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
