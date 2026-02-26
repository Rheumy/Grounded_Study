import crypto from "crypto";
import { extractPdfText } from "@/lib/ingestion/pdf";
import { chunkText, hashChunk } from "@/lib/ingestion/chunk";
import { insertChunk } from "@/lib/ingestion/store";
import { embedText } from "@/lib/llm/embeddings";
import { ocrImage } from "@/lib/ingestion/ocr";
import { logger } from "@/lib/observability/logger";

const MAX_CHUNK_CHARS = 1200;
const CHUNK_OVERLAP = 200;

export async function ingestDocument(params: {
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
    const text = await ocrImage(params.buffer, params.contentType);
    pages = text ? [{ page: 1, text }] : [];
  } else {
    const text = params.buffer.toString("utf8");
    pages = text ? [{ page: 1, text }] : [];
  }

  if (pages.length === 0) {
    throw new Error("No extractable text found.");
  }

  let chunkIndex = 0;
  for (const page of pages) {
    const chunks = chunkText(page.text, MAX_CHUNK_CHARS, CHUNK_OVERLAP);
    for (const chunk of chunks) {
      const embedding = await embedText(chunk);
      const hash = hashChunk(chunk);
      await insertChunk({
        id: crypto.randomUUID(),
        documentId: params.documentId,
        content: chunk,
        embedding,
        page: page.page,
        chunkIndex,
        hash
      });
      chunkIndex += 1;
    }
  }

  logger.info({ documentId: params.documentId, chunkCount: chunkIndex }, "Ingestion complete");
  return { chunkCount: chunkIndex, pageCount: pages.length };
}
