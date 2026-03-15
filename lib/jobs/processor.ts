import { prisma } from "@/lib/db/prisma";
import { readFile } from "@/lib/storage/storage";
import { ingestDocument } from "@/lib/ingestion/ingest";
import { logger } from "@/lib/observability/logger";

export async function processIngestionJob(jobId: string) {
  const job = await prisma.ingestionJob.findUnique({
    where: { id: jobId },
    include: { document: true }
  });

  if (!job) {
    throw new Error("Job not found");
  }

  const document = job.document;
  logger.info(
    {
      jobId,
      documentId: document.id,
      sourceType: document.sourceType,
      currentStatus: document.status
    },
    "Ingestion started"
  );

  await prisma.document.update({
    where: { id: document.id },
    data: { status: "PROCESSING" }
  });
  logger.info({ jobId, documentId: document.id }, "Document marked processing");

  const buffer = await readFile(document.storageKey);
  try {
    const { chunkCount, pageCount } = await ingestDocument({
      documentId: document.id,
      sourceType: document.sourceType,
      buffer,
      contentType: document.contentType
    });

    await prisma.document.update({
      where: { id: document.id },
      data: { status: "READY", pageCount: pageCount ?? document.pageCount }
    });

    logger.info(
      { jobId, documentId: document.id, chunkCount, pageCount },
      "Document marked complete"
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (document.sourceType === "IMAGE" && message.includes("OpenAI API key")) {
      await prisma.document.update({
        where: { id: document.id },
        data: { status: "OCR_DISABLED" }
      });
      logger.error({ jobId, documentId: document.id, message }, "Ingestion failed and OCR was disabled");
    } else {
      await prisma.document.update({
        where: { id: document.id },
        data: { status: "FAILED" }
      });
      logger.error({ jobId, documentId: document.id, message }, "Ingestion failed");
    }
    throw error;
  }
}
