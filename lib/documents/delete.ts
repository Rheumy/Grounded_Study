import { prisma } from "@/lib/db/prisma";
import { deleteFile } from "@/lib/storage/storage";

export async function deleteDocument(documentId: string, ownerId: string) {
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document || document.ownerId !== ownerId) {
    throw new Error("Document not found");
  }
  await prisma.document.delete({ where: { id: documentId } });
  await deleteFile(document.storageKey);
  return true;
}
