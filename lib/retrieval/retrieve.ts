import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { embedText } from "@/lib/llm/embeddings";
import { logger } from "@/lib/observability/logger";

export type RetrievedChunk = {
  id: string;
  documentId: string;
  content: string;
  page: number | null;
  chunkIndex: number;
};

export async function retrieveChunks(params: {
  query: string;
  documentIds: string[];
  limit?: number;
}): Promise<RetrievedChunk[]> {
  logger.info(
    {
      documentCount: params.documentIds.length,
      queryLength: params.query.length,
      limit: params.limit ?? 6
    },
    "Retrieval invoked"
  );

  const vector = await embedText(params.query);
  const vectorLiteral = `[${vector.join(",")}]`;
  const limit = params.limit ?? 6;

  if (params.documentIds.length === 0) {
    return [];
  }

  const ids = Prisma.join(params.documentIds);
  const results = await prisma.$queryRaw<RetrievedChunk[]>`
    SELECT "id", "documentId", "content", "page", "chunkIndex"
    FROM "DocumentChunk"
    WHERE "documentId" IN (${ids})
    ORDER BY "embedding" <-> ${vectorLiteral}::vector
    LIMIT ${limit}
  `;

  logger.info(
    {
      documentCount: params.documentIds.length,
      returnedChunkCount: results.length,
      limit
    },
    "Retrieval returned chunks"
  );

  return results;
}
