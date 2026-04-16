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

function countMatches(value: string, pattern: RegExp): number {
  const matches = value.match(pattern);
  return matches ? matches.length : 0;
}

export function getNonEducationalChunkReason(content: string): string | null {
  const normalized = content.replace(/\s+/g, " ").trim().toLowerCase();

  if (!normalized) {
    return "empty_chunk";
  }

  if (
    /\btable of contents\b/.test(normalized) ||
    /\ball rights reserved\b/.test(normalized) ||
    /\bcopyright\b/.test(normalized) ||
    /\babout the authors?\b/.test(normalized) ||
    /\bauthor affiliations?\b/.test(normalized) ||
    /\bcorrespondence to\b/.test(normalized) ||
    /\bconflict of interest\b/.test(normalized) ||
    /\bfunding statement\b/.test(normalized) ||
    /\bpage \d+ of \d+\b/.test(normalized) ||
    /\bisbn\b/.test(normalized) ||
    /\bissn\b/.test(normalized)
  ) {
    return "document_metadata";
  }

  if (
    /^(references|bibliography|works cited)\b/.test(normalized) ||
    (/\bdoi[:\s]/.test(normalized) && countMatches(normalized, /\b\d{4}\b/g) >= 2) ||
    countMatches(normalized, /\bet al\.?\b/g) >= 2
  ) {
    return "reference_list";
  }

  if (
    normalized.length < 320 &&
    countMatches(normalized, /\b(?:chapter|section|appendix)\b/g) >= 2 &&
    countMatches(normalized, /\b\d{1,3}\b/g) >= 4
  ) {
    return "table_of_contents_like";
  }

  return null;
}

export async function retrieveChunks(params: {
  query: string;
  documentIds: string[];
  limit?: number;
  userId?: string | null;
}): Promise<RetrievedChunk[]> {
  logger.info(
    {
      documentCount: params.documentIds.length,
      queryLength: params.query.length,
      limit: params.limit ?? 6
    },
    "Retrieval invoked"
  );

  const vector = await embedText(params.query, {
    feature: "retrieval_query_embedding",
    userId: params.userId ?? null,
    documentId: params.documentIds.length === 1 ? params.documentIds[0] : null,
    metadata: {
      documentCount: params.documentIds.length,
      limit: params.limit ?? 6,
      queryLength: params.query.length
    }
  });
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

  const filteredResults = results.filter((chunk) => !getNonEducationalChunkReason(chunk.content));

  if (filteredResults.length !== results.length) {
    logger.info(
      {
        documentCount: params.documentIds.length,
        filteredChunkCount: results.length - filteredResults.length,
        returnedChunkCount: filteredResults.length,
        limit
      },
      "Retrieval filtered non-educational chunks"
    );
  }

  logger.info(
    {
      documentCount: params.documentIds.length,
      returnedChunkCount: filteredResults.length,
      limit
    },
    "Retrieval returned chunks"
  );

  return filteredResults;
}
