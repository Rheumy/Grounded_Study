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
  await prisma.document.update({
    where: { id: document.id },
    data: { status: "PROCESSING" }
  });

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

    logger.info({ jobId, documentId: document.id, chunkCount }, "Job processed");
  } catch (error) {
    const message = error instanceof Error ? error.message : \"Unknown error\";
    if (document.sourceType === \"IMAGE\" && message.includes(\"OpenAI API key\")) {
      await prisma.document.update({
        where: { id: document.id },
        data: { status: \"OCR_DISABLED\" }
      });
    } else {
      await prisma.document.update({
        where: { id: document.id },
        data: { status: \"FAILED\" }
      });
    }
    throw error;
  }
}
