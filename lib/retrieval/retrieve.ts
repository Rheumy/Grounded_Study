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
    /^(contents|table of contents)\b/.test(normalized) ||
    /\btable of contents\b/.test(normalized) ||
    /\ball rights reserved\b/.test(normalized) ||
    /\bcopyright\b/.test(normalized) ||
    /\bpublisher\b/.test(normalized) ||
    /\bpublished by\b/.test(normalized) ||
    /\bpublication date\b/.test(normalized) ||
    /\babout the authors?\b/.test(normalized) ||
    /\bauthor information\b/.test(normalized) ||
    /\bauthor biography\b/.test(normalized) ||
    /\bcontributors?\b/.test(normalized) ||
    /\bauthor affiliations?\b/.test(normalized) ||
    /\bauthors?[’'] qualifications?\b/.test(normalized) ||
    /\bcorrespondence to\b/.test(normalized) ||
    /\bconflict of interest\b/.test(normalized) ||
    /\bfunding statement\b/.test(normalized) ||
    /\backnowledg(e)?ments?\b/.test(normalized) ||
    /\bforeword\b/.test(normalized) ||
    /\bpreface\b/.test(normalized) ||
    /\bbiographical note\b/.test(normalized) ||
    /\breceived\b.*\brevised\b.*\baccepted\b/.test(normalized) ||
    /\bopen access\b/.test(normalized) ||
    /\bpermissions?\b/.test(normalized) ||
    /\blicense\b/.test(normalized) ||
    /\bpage \d+ of \d+\b/.test(normalized) ||
    /\bisbn\b/.test(normalized) ||
    /\bissn\b/.test(normalized)
  ) {
    return "document_metadata";
  }

  if (
    /^(references|bibliography|works cited|further reading|suggested reading|index)\b/.test(normalized) ||
    /\breference list\b/.test(normalized) ||
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

export function getEducationalChunkScore(content: string): number {
  const normalized = content.replace(/\s+/g, " ").trim().toLowerCase();

  if (!normalized || getNonEducationalChunkReason(content)) {
    return 0;
  }

  let score = Math.min(6, Math.round(normalized.length / 220));

  score += countMatches(
    normalized,
    /\b(?:because|therefore|however|whereas|compared with|in contrast|if|when|mechanism|pathway|process|effect|increases?|decreases?|results? in|leads? to|associated with|indicates?|suggests?)\b/g
  );
  score += countMatches(
    normalized,
    /\b(?:defined as|characterized by|consists of|includes|causes?|distinguish|difference|versus|management|diagnosis|treatment|principle|concept|function|relationship|application|comparison)\b/g
  );

  if (countMatches(normalized, /\b(?:chapter|section|appendix)\b/g) >= 2) {
    score -= 2;
  }

  return Math.max(0, score);
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
  const candidateLimit = Math.max(limit * 4, 16);

  if (params.documentIds.length === 0) {
    return [];
  }

  const ids = Prisma.join(params.documentIds);
  const results = await prisma.$queryRaw<RetrievedChunk[]>`
    SELECT "id", "documentId", "content", "page", "chunkIndex"
    FROM "DocumentChunk"
    WHERE "documentId" IN (${ids})
    ORDER BY "embedding" <-> ${vectorLiteral}::vector
    LIMIT ${candidateLimit}
  `;

  const filteredResults: RetrievedChunk[] = [];
  let filteredChunkCount = 0;

  for (const chunk of results) {
    if (getNonEducationalChunkReason(chunk.content)) {
      filteredChunkCount += 1;
      continue;
    }

    filteredResults.push(chunk);
  }

  const returnedChunks = filteredResults.slice(0, limit);
  const metadataDominatedRetrieval =
    results.length >= Math.min(candidateLimit, 8) &&
    filteredChunkCount >= Math.ceil(results.length * 0.6) &&
    returnedChunks.length < 2;

  if (filteredChunkCount > 0) {
    logger.info(
      {
        documentCount: params.documentIds.length,
        filteredChunkCount,
        returnedChunkCount: returnedChunks.length,
        requestedLimit: limit,
        candidateLimit
      },
      "Retrieval filtered non-educational chunks"
    );
  }

  if (metadataDominatedRetrieval) {
    logger.warn(
      {
        documentCount: params.documentIds.length,
        filteredChunkCount,
        rawChunkCount: results.length,
        returnedChunkCount: returnedChunks.length,
        requestedLimit: limit
      },
      "Retrieval was dominated by metadata-like chunks"
    );

    return [];
  }

  logger.info(
    {
      documentCount: params.documentIds.length,
      returnedChunkCount: returnedChunks.length,
      requestedLimit: limit,
      candidateLimit
    },
    "Retrieval returned chunks"
  );

  return returnedChunks;
}
