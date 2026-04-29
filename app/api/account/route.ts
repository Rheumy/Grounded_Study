import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";
import { deleteFile } from "@/lib/storage/storage";
import { logger } from "@/lib/observability/logger";

export async function DELETE() {
  const user = await requireUserApi();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const documents = await prisma.document.findMany({
    where: { ownerId: user.id },
    select: { id: true, storageKey: true }
  });
  const questions = await prisma.question.findMany({
    where: { ownerId: user.id },
    select: { id: true }
  });
  const documentIds = documents.map((document) => document.id);
  const questionIds = questions.map((question) => question.id);
  const ownedUsageFilters = [
    { userId: user.id },
    ...(documentIds.length > 0 ? [{ documentId: { in: documentIds } }] : []),
    ...(questionIds.length > 0 ? [{ questionId: { in: questionIds } }] : [])
  ];

  await Promise.all(
    documents.map((document) =>
      deleteFile(document.storageKey).catch((error) => {
        logger.warn(
          {
            userId: user.id,
            documentId: document.id,
            storageKey: document.storageKey,
            message: error instanceof Error ? error.message : String(error)
          },
          "Account deletion could not remove stored file"
        );
      })
    )
  );

  await prisma.$transaction(async (tx) => {
    await tx.chunkUsage.deleteMany({
      where: {
        OR: ownedUsageFilters
      }
    });
    await tx.aiUsageEvent.deleteMany({
      where: {
        OR: ownedUsageFilters
      }
    });
    await tx.verificationToken.deleteMany({
      where: user.email ? { identifier: user.email } : { identifier: "__none__" }
    });
    await tx.user.delete({
      where: { id: user.id }
    });
  });

  logger.info({ userId: user.id }, "User deleted account");

  return NextResponse.json({ ok: true });
}
