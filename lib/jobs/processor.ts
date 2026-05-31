import { prisma } from "@/lib/db/prisma";
import { readFile } from "@/lib/storage/storage";
import { ingestDocument } from "@/lib/ingestion/ingest";
import { logger } from "@/lib/observability/logger";
import { incrementUsage } from "@/lib/billing/usage";
import { generateQuestions, type GenerationProgressEvent, type TypeMix } from "@/lib/llm/generate";
import { resolvePreset } from "@/lib/llm/presets";
import { sanitizeGenerationErrorMessage } from "@/lib/jobs/errors";

const ZERO_SAVED_GENERATION_MESSAGE =
  "No valid questions were saved. Please try again with a smaller or more focused source.";

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
      ownerId: document.ownerId,
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

function parseStringArrayJson(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function parseTypeMixJson(value: unknown): TypeMix | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  return {
    MCQ: Number(raw.MCQ ?? 0),
    SHORT_ANSWER: Number(raw.SHORT_ANSWER ?? 0),
    TRUE_FALSE: Number(raw.TRUE_FALSE ?? 0)
  };
}

function phaseText(event: GenerationProgressEvent): string {
  if (event.phase === "retrieving") {
    return "Retrieving relevant material";
  }

  if (event.phase === "generating") {
    return `Generating question ${event.questionNumber} of ${event.totalQuestions}`;
  }

  if (event.phase === "verifying") {
    return `Verifying question ${event.questionNumber}`;
  }

  if (event.phase === "saving") {
    return `Saving question ${event.questionNumber}`;
  }

  return `Saved question ${event.questionNumber} of ${event.totalQuestions}`;
}

export async function processGenerationJob(jobId: string) {
  const job = await prisma.generationJob.findUnique({
    where: { id: jobId }
  });

  if (!job) {
    throw new Error("Generation job not found");
  }

  if (job.status !== "PROCESSING") {
    const claimed = await prisma.generationJob.updateMany({
      where: { id: jobId, status: "PENDING" },
      data: {
        status: "PROCESSING",
        startedAt: new Date(),
        currentPhase: "Starting generation",
        errorMessage: null
      }
    });

    if (claimed.count === 0) {
      throw new Error("Generation job is not available for processing");
    }
    logger.info({ jobId, status: "PROCESSING" }, "Job transitioned to status PROCESSING");
  }

  const documentIds = parseStringArrayJson(job.documentIds);
  const typeMix = parseTypeMixJson(job.typeMix);
  const presetStyleProfile = job.presetKey ? resolvePreset(job.presetKey) : null;

  logger.info(
    {
      jobId,
      userId: job.userId,
      documentIds,
      requestedCount: job.requestedCount,
      difficulty: job.difficulty,
      typeMix
    },
    "Generation job processing started"
  );

  try {
    const results = await generateQuestions({
      ownerId: job.userId,
      documentIds,
      styleProfileId: job.styleProfileId,
      presetStyleProfile,
      difficulty: job.difficulty,
      count: job.requestedCount,
      typeMix,
      onProgress: async (event) => {
        await prisma.generationJob.update({
          where: { id: jobId },
          data: {
            currentPhase: phaseText(event),
            ...(event.phase === "saved" ? { passedCount: event.passedCount } : {})
          }
        });
      }
    });

    const passedCount = results.filter((result) => result.status === "PASSED").length;
    if (passedCount === 0) {
      await prisma.generationJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          passedCount: 0,
          currentPhase: "No valid questions were saved",
          completedAt: new Date(),
          errorMessage: ZERO_SAVED_GENERATION_MESSAGE
        }
      });
      logger.info(
        {
          jobId,
          status: "FAILED",
          userId: job.userId,
          requestedCount: job.requestedCount,
          typeMix,
          passedCount: 0
        },
        "Generation job completed with zero saved questions"
      );
      return;
    }

    await incrementUsage({ userId: job.userId, questions: passedCount });
    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        passedCount,
        currentPhase:
          passedCount < job.requestedCount
            ? `Generation complete: ${passedCount} of ${job.requestedCount} saved`
            : "Generation complete",
        completedAt: new Date(),
        errorMessage: null
      }
    });
    logger.info({ jobId, status: "COMPLETED" }, "Job transitioned to status COMPLETED");

    logger.info(
      { jobId, userId: job.userId, requestedCount: job.requestedCount, passedCount },
      "Generation job completed"
    );
  } catch (error) {
    const message = sanitizeGenerationErrorMessage(error);
    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        currentPhase: "Generation failed",
        completedAt: new Date(),
        errorMessage: message
      }
    });
    logger.info({ jobId, status: "FAILED", message }, "Job transitioned to status FAILED");
    logger.error({ jobId, userId: job.userId, message }, "Generation job failed");
    throw error;
  }
}
