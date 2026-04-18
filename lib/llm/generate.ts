import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { generateQuestion, type RetrievalChunk } from "@/lib/llm/question-generator";
import { verifyQuestion } from "@/lib/llm/verifier/verifier";
import {
  getEducationalChunkScore,
  getNonEducationalChunkReason,
  retrieveChunks
} from "@/lib/retrieval/retrieve";
import { logger } from "@/lib/observability/logger";
import { sanitizeFeedbackText } from "@/lib/feedback/user-facing";

const MAX_RETRIES = 3;

type QuestionTypeName = "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE";
type RetryMode = "initial_retrieval" | "same_chunks" | "refreshed_retrieval";

function durationMs(startedAt: number): number {
  return Date.now() - startedAt;
}

export type TypeMix = {
  MCQ?: number;
  SHORT_ANSWER?: number;
  TRUE_FALSE?: number;
};

async function getRandomChunkSnippet(documentIds: string[]) {
  if (documentIds.length === 0) return "core concepts";
  const ids = Prisma.join(documentIds);
  const chunks = await prisma.$queryRaw<RetrievalChunk[]>`
    SELECT "id", "documentId", "content", "page", "chunkIndex"
    FROM "DocumentChunk"
    WHERE "documentId" IN (${ids})
    ORDER BY random()
    LIMIT 12
  `;
  const chunk = chunks
    .filter((candidate) => !getNonEducationalChunkReason(candidate.content))
    .map((candidate) => ({
      chunk: candidate,
      score: getEducationalChunkScore(candidate.content)
    }))
    .sort((a, b) => b.score - a.score)[0]?.chunk;

  if (!chunk && chunks.length > 0) {
    logger.info(
      {
        documentCount: documentIds.length,
        sampledChunkCount: chunks.length
      },
      "Random retrieval seed fell back because sampled chunks looked non-educational"
    );
  }

  return chunk?.content?.slice(0, 200) ?? "core concepts and key principles";
}

function toStyleProfileObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function buildGenerationStyleProfile(
  styleProfile:
    | {
        name: string;
        schemaJson: Prisma.JsonValue;
        instructionsText: string | null;
      }
    | null
): Record<string, unknown> {
  if (!styleProfile) {
    return {};
  }

  const schemaJson = toStyleProfileObject(styleProfile.schemaJson);

  return {
    ...schemaJson,
    profileName: styleProfile.name,
    ...(styleProfile.instructionsText
      ? {
          explicitUserInstructions: styleProfile.instructionsText
        }
      : {})
  };
}

function shouldRefreshRetrievalAfterVerifierFailure(reason: string) {
  const normalized = reason.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (normalized.startsWith("verifier returned")) {
    return false;
  }

  return true;
}

/**
 * Builds the ordered list of question types to generate.
 * Explicit typeMix always wins. Falls back to profile weights, then all-MCQ default.
 */
function buildTypeSlots(
  count: number,
  typeMix: TypeMix | null,
  profileDistribution: { MCQ?: number; SHORT_ANSWER?: number; TRUE_FALSE?: number } | null
): QuestionTypeName[] {
  let mcqCount = 0;
  let shortAnswerCount = 0;
  let trueFalseCount = 0;

  if (typeMix) {
    // User-provided explicit override
    mcqCount = typeMix.MCQ ?? 0;
    shortAnswerCount = typeMix.SHORT_ANSWER ?? 0;
    trueFalseCount = typeMix.TRUE_FALSE ?? 0;
  } else if (profileDistribution) {
    // Infer from profile weights via proportional rounding
    const mcqW = profileDistribution.MCQ ?? 0;
    const saW = profileDistribution.SHORT_ANSWER ?? 0;
    const tfW = profileDistribution.TRUE_FALSE ?? 0;
    const totalWeight = mcqW + saW + tfW;

    if (totalWeight > 0) {
      mcqCount = Math.round(count * (mcqW / totalWeight));
      shortAnswerCount = Math.round(count * (saW / totalWeight));
      trueFalseCount = count - mcqCount - shortAnswerCount;
      // Ensure non-negative and total = count
      if (trueFalseCount < 0) {
        mcqCount += trueFalseCount;
        trueFalseCount = 0;
      }
      if (mcqCount < 0) {
        shortAnswerCount += mcqCount;
        mcqCount = 0;
      }
    } else {
      // All weights are zero — default to MCQ
      mcqCount = count;
    }
  } else {
    // No profile — default to all MCQ (preserves existing behaviour)
    mcqCount = count;
  }

  // Build and shuffle the slots array
  const slots: QuestionTypeName[] = [
    ...Array(mcqCount).fill("MCQ" as QuestionTypeName),
    ...Array(shortAnswerCount).fill("SHORT_ANSWER" as QuestionTypeName),
    ...Array(trueFalseCount).fill("TRUE_FALSE" as QuestionTypeName)
  ];

  // Fisher-Yates shuffle for varied ordering
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }

  return slots;
}

export async function generateQuestions(params: {
  ownerId: string;
  documentIds: string[];
  styleProfileId: string | null;
  difficulty: number;
  count: number;
  typeMix?: TypeMix | null;
}) {
  logger.info(
    {
      ownerId: params.ownerId,
      documentCount: params.documentIds.length,
      styleProfileId: params.styleProfileId,
      difficulty: params.difficulty,
      requestedCount: params.count,
      typeMix: params.typeMix ?? null
    },
    "Generation started"
  );

  const styleProfile = params.styleProfileId
    ? await prisma.styleProfile.findFirst({
        where: { id: params.styleProfileId, ownerId: params.ownerId }
      })
    : null;

  if (params.styleProfileId && !styleProfile) {
    throw new Error("Style profile not found");
  }

  // Extract the profile distribution (if available) for inferring type mix
  const profileSchema = styleProfile?.schemaJson as
    | { questionTypeDistribution?: { MCQ?: number; SHORT_ANSWER?: number; TRUE_FALSE?: number } }
    | null;
  const profileDistribution = profileSchema?.questionTypeDistribution ?? null;
  const generationStyleProfile = buildGenerationStyleProfile(styleProfile);

  const typeSlots = buildTypeSlots(params.count, params.typeMix ?? null, profileDistribution);

  const results = [] as { questionId?: string; status: string; reason?: string }[];

  for (let i = 0; i < params.count; i += 1) {
    const questionType = typeSlots[i] ?? "MCQ";
    let saved = false;
    let reason = "";
    let retryMode: RetryMode = "initial_retrieval";
    let currentQuery = "";
    let currentChunks: RetrievalChunk[] = [];

    for (let attempt = 0; attempt < MAX_RETRIES && !saved; attempt += 1) {
      if (retryMode !== "same_chunks" || currentChunks.length === 0) {
        const retrievalStartedAt = Date.now();
        logger.info(
          {
            ownerId: params.ownerId,
            questionType,
            attempt: attempt + 1,
            retryMode
          },
          "Question retrieval started"
        );
        currentQuery = await getRandomChunkSnippet(params.documentIds);
        currentChunks = await retrieveChunks({
          query: currentQuery,
          documentIds: params.documentIds,
          limit: 6,
          userId: params.ownerId
        });
        logger.info(
          {
            ownerId: params.ownerId,
            questionType,
            attempt: attempt + 1,
            retryMode,
            chunkCount: currentChunks.length,
            phaseDurationMs: durationMs(retrievalStartedAt)
          },
          "Question retrieval completed"
        );
      }

      logger.info(
        {
          ownerId: params.ownerId,
          questionType,
          attempt: attempt + 1,
          retryMode,
          chunkCount: currentChunks.length
        },
        "Generation attempt started"
      );

      if (currentChunks.length === 0) {
        reason = "Retrieved material was mostly document metadata or lacked enough teachable content";
        retryMode = "refreshed_retrieval";
        continue;
      }

      let generated;
      try {
        const generationStartedAt = Date.now();
        logger.info(
          {
            ownerId: params.ownerId,
            questionType,
            attempt: attempt + 1,
            retryMode,
            chunkCount: currentChunks.length
          },
          "Question LLM generation started"
        );
        generated = await generateQuestion({
          styleProfile: generationStyleProfile,
          difficulty: params.difficulty,
          questionType,
          chunks: currentChunks,
          userId: params.ownerId,
          documentId: params.documentIds.length === 1 ? params.documentIds[0] : null,
          metadata: {
            attempt: attempt + 1,
            requestedCount: params.count,
            styleProfileId: params.styleProfileId
          }
        });
        logger.info(
          {
            ownerId: params.ownerId,
            questionType,
            attempt: attempt + 1,
            retryMode,
            phaseDurationMs: durationMs(generationStartedAt)
          },
          "Question LLM generation completed"
        );
      } catch (genError) {
        // Log the raw error (e.g. Zod validation failure on LLM output) and retry
        logger.warn(
          {
            ownerId: params.ownerId,
            questionType,
            attempt: attempt + 1,
            retryMode: "same_chunks",
            error: genError instanceof Error ? genError.message : String(genError)
          },
          "generateQuestion threw — retrying with same chunks"
        );
        reason = "Question generation produced an invalid response";
        retryMode = "same_chunks";
        continue;
      }

      if (generated.verifierStatus === "INSUFFICIENT_EVIDENCE") {
        reason = "Insufficient evidence";
        retryMode = "refreshed_retrieval";
        continue;
      }

      const chunkIds = new Set(currentChunks.map((chunk) => chunk.id));
      const citationsValid = generated.citations.every((citation) =>
        chunkIds.has(citation.chunkId)
      );
      if (!citationsValid) {
        reason = "Citations reference unknown chunks";
        retryMode = "refreshed_retrieval";
        continue;
      }

      let verifier;
      try {
        const verifierStartedAt = Date.now();
        logger.info(
          {
            ownerId: params.ownerId,
            questionType,
            attempt: attempt + 1,
            retryMode
          },
          "Question verifier started"
        );
        verifier = await verifyQuestion({
          question: generated,
          chunks: currentChunks,
          styleProfile: generationStyleProfile,
          userId: params.ownerId,
          documentId: params.documentIds.length === 1 ? params.documentIds[0] : null,
          metadata: {
            attempt: attempt + 1,
            requestedCount: params.count
          }
        });
        logger.info(
          {
            ownerId: params.ownerId,
            questionType,
            attempt: attempt + 1,
            retryMode,
            phaseDurationMs: durationMs(verifierStartedAt)
          },
          "Question verifier completed"
        );
      } catch (verifyError) {
        logger.warn(
          {
            ownerId: params.ownerId,
            questionType,
            attempt: attempt + 1,
            retryMode: "same_chunks",
            error: verifyError instanceof Error ? verifyError.message : String(verifyError)
          },
          "verifyQuestion threw — retrying with same chunks"
        );
        reason = "Verification step failed unexpectedly";
        retryMode = "same_chunks";
        continue;
      }

      if (verifier.status === "FAILED") {
        reason = verifier.reason;
        if (verifier.failureCodes?.includes("LOW_EDUCATIONAL_VALUE")) {
          logger.info(
            {
              ownerId: params.ownerId,
              questionType,
              attempt: attempt + 1,
              reason: verifier.reason
            },
            "Verifier rejected low-educational-value question"
          );
        }
        retryMode = shouldRefreshRetrievalAfterVerifierFailure(verifier.reason)
          ? "refreshed_retrieval"
          : "same_chunks";
        continue;
      }

      const saveStartedAt = Date.now();
      logger.info(
        {
          ownerId: params.ownerId,
          questionType,
          attempt: attempt + 1
        },
        "Question DB save started"
      );
      const record = await prisma.question.create({
        data: {
          ownerId: params.ownerId,
          styleProfileId: params.styleProfileId,
          difficulty: generated.difficulty,
          type: generated.type,
          stem: sanitizeFeedbackText(generated.stem),
          optionsJson: generated.options ?? undefined,
          answer: sanitizeFeedbackText(generated.answer),
          rationale: sanitizeFeedbackText(generated.rationale),
          citationsJson: generated.citations,
          verifierStatus: "PASSED",
          tagsJson: generated.tags ?? undefined
        }
      });
      logger.info(
        {
          ownerId: params.ownerId,
          questionType,
          attempt: attempt + 1,
          questionId: record.id,
          phaseDurationMs: durationMs(saveStartedAt)
        },
        "Question DB save completed"
      );

      results.push({ questionId: record.id, status: "PASSED" });
      saved = true;
    }

    if (!saved) {
      logger.warn(
        { ownerId: params.ownerId, attemptIndex: i + 1, questionType, reason },
        "Question generation failed after retries"
      );
      results.push({ status: "INSUFFICIENT_EVIDENCE", reason });
    }
  }

  const passed = results.filter((result) => result.status === "PASSED").length;
  const failed = results.length - passed;
  logger.info(
    {
      ownerId: params.ownerId,
      documentCount: params.documentIds.length,
      requestedCount: params.count,
      passedCount: passed,
      failedCount: failed
    },
    "Generation completed"
  );

  return results;
}
