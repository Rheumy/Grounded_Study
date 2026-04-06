import crypto from "crypto";
import { extractPdfText } from "@/lib/ingestion/pdf";
import { chunkText, hashChunk } from "@/lib/ingestion/chunk";
import { insertChunk } from "@/lib/ingestion/store";
import { EMBEDDING_MODEL, embedTextWithUsage } from "@/lib/llm/embeddings";
import { ocrImage } from "@/lib/ingestion/ocr";
import { recordAiUsageEvent } from "@/lib/observability/ai-usage";
import { logger } from "@/lib/observability/logger";

const MAX_CHUNK_CHARS = 1200;
const CHUNK_OVERLAP = 200;

export async function ingestDocument(params: {
  ownerId: string;
  documentId: string;
  sourceType: "PDF" | "IMAGE" | "TEXT";
  buffer: Buffer;
  contentType: string;
}): Promise<{ chunkCount: number; pageCount?: number }> {
  const maxPages = Number(process.env.MAX_PDF_PAGES ?? 400);
  let pages: { page: number; text: string }[] = [];

  if (params.sourceType === "PDF") {
    pages = await extractPdfText(params.buffer, maxPages);
  } else if (params.sourceType === "IMAGE") {
    const text = await ocrImage(params.buffer, params.contentType, {
      userId: params.ownerId,
      documentId: params.documentId,
      metadata: {
        source: "document_ingestion",
        contentType: params.contentType
      }
    });
    pages = text ? [{ page: 1, text }] : [];
  } else {
    const text = params.buffer.toString("utf8");
    pages = text ? [{ page: 1, text }] : [];
  }

  if (pages.length === 0) {
    throw new Error("No extractable text found.");
  }

  logger.info(
    { documentId: params.documentId, sourceType: params.sourceType, pageCount: pages.length },
    "Text extraction completed"
  );

  const preparedChunks: Array<{ page: number; chunk: string }> = [];
  for (const page of pages) {
    const chunks = chunkText(page.text, MAX_CHUNK_CHARS, CHUNK_OVERLAP);
    for (const chunk of chunks) {
      preparedChunks.push({ page: page.page, chunk });
    }
  }

  logger.info(
    { documentId: params.documentId, chunkCount: preparedChunks.length },
    "Chunking completed"
  );

  let chunkIndex = 0;
  let totalEmbeddingInputTokens = 0;
  let totalEmbeddingTokens = 0;
  let totalEmbeddingCostUsd = 0;
  for (const preparedChunk of preparedChunks) {
    const chunk = preparedChunk.chunk;
    const { vector: embedding, usage } = await embedTextWithUsage(chunk);
    const hash = hashChunk(chunk);
    await insertChunk({
      id: crypto.randomUUID(),
      documentId: params.documentId,
      content: chunk,
      embedding,
      page: preparedChunk.page,
      chunkIndex,
      hash
    });
    totalEmbeddingInputTokens += usage.inputTokens ?? 0;
    totalEmbeddingTokens += usage.totalTokens ?? 0;
    totalEmbeddingCostUsd += usage.estimatedCostUsd;
    chunkIndex += 1;
  }

  if (chunkIndex > 0) {
    await recordAiUsageEvent({
      feature: "document_embedding",
      provider: "openai",
      model: EMBEDDING_MODEL,
      userId: params.ownerId,
      documentId: params.documentId,
      inputTokens: totalEmbeddingInputTokens,
      outputTokens: 0,
      totalTokens: totalEmbeddingTokens,
      metadata: {
        sourceType: params.sourceType,
        chunkCount: chunkIndex,
        pageCount: pages.length,
        estimatedCostUsd: Number(totalEmbeddingCostUsd.toFixed(8))
      }
    });
  }

  logger.info(
    { documentId: params.documentId, embeddedChunkCount: chunkIndex },
    "Embedding completed"
  );

  return { chunkCount: chunkIndex, pageCount: pages.length };
}
