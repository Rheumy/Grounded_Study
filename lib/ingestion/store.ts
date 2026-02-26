import { Prisma, type DocumentChunk } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export type ChunkInsert = {
  id: string;
  documentId: string;
  content: string;
  embedding: number[];
  page?: number | null;
  chunkIndex: number;
  hash: string;
};

export async function insertChunk(chunk: ChunkInsert): Promise<DocumentChunk | null> {
  const vectorLiteral = `[${chunk.embedding.join(",")}]`;
  const result = await prisma.$executeRaw`
    INSERT INTO "DocumentChunk" ("id", "documentId", "content", "embedding", "page", "chunkIndex", "hash", "createdAt")
    VALUES (
      ${chunk.id},
      ${chunk.documentId},
      ${chunk.content},
      ${Prisma.raw(vectorLiteral)}::vector,
      ${chunk.page ?? null},
      ${chunk.chunkIndex},
      ${chunk.hash},
      now()
    )
    ON CONFLICT DO NOTHING
  `;
  if (!result) return null;
  return prisma.documentChunk.findUnique({ where: { id: chunk.id } });
}
