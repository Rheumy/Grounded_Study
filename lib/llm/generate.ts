import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { generateQuestion, type RetrievalChunk } from "@/lib/llm/question-generator";
import {
  normalizeAssumedBackgroundLevel,
  type AssumedBackgroundLevel
} from "@/lib/llm/schemas/style-profile";
import { verifyQuestion } from "@/lib/llm/verifier/verifier";
import {
  getEducationalChunkScore,
  getNonEducationalChunkReason,
  retrieveChunks
} from "@/lib/retrieval/retrieve";
import { logger } from "@/lib/observability/logger";
import { sanitizeFeedbackText } from "@/lib/feedback/user-facing";

const MAX_RETRIES = 3;
const OUTSIDER_RETRY_BONUS = 1;

type QuestionTypeName = "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE";
type RetryMode = "initial_retrieval" | "same_chunks" | "refreshed_retrieval";
type RetryStrategy = "default" | "narrow_source_specific";

function durationMs(startedAt: number): number {
  return Date.now() - startedAt;
}

export type TypeMix = {
  MCQ?: number;
  SHORT_ANSWER?: number;
  TRUE_FALSE?: number;
};

function countMatches(value: string, pattern: RegExp): number {
  const matches = value.match(pattern);
  return matches ? matches.length : 0;
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getSourceSpecificSignalScore(content: string): number {
  const normalized = normalizeSpace(content).toLowerCase();

  if (!normalized || getNonEducationalChunkReason(content)) {
    return 0;
  }

  return (
    countMatches(
      normalized,
      /\b(?:although|compared with|compared to|despite|except|however|if|in contrast|instead|less than|more than|rather than|relative to|unless|versus|when|within|without)\b/g
    ) * 2 +
    countMatches(
      normalized,
      /\b(?:caveat|condition|contraindication|criteria|criterion|exception|implication|threshold|timing)\b/g
    ) * 2 +
    countMatches(normalized, /\b\d+(?:\.\d+)?(?:%|x)?\b/g)
  );
}

function extractQuerySnippet(content: string, strategy: RetryStrategy): string {
  const collapsed = normalizeSpace(content);
  if (!collapsed) {
    return "core concepts and key principles";
  }

  if (strategy === "default") {
    return collapsed.slice(0, 200);
  }

  const normalized = collapsed.toLowerCase();
  const focusPattern =
    /\b(?:although|compared with|compared to|despite|except|however|if|in contrast|instead|less than|more than|rather than|relative to|unless|versus|vs\.?|when|within|without|caveat|condition|contraindication|criteria|criterion|exception|implication|threshold|timing|\d+(?:\.\d+)?(?:%|x)?)\b/;
  const match = focusPattern.exec(normalized);

  if (!match) {
    return collapsed.slice(0, 220);
  }

  const start = Math.max(0, match.index - 90);
  return collapsed.slice(start, start + 220);
}

function buildNarrowRetryQuery(sourceChunks: RetrievalChunk[]): string | null {
  if (sourceChunks.length === 0) {
    return null;
  }

  const bestChunk = sourceChunks
    .filter((chunk) => !getNonEducationalChunkReason(chunk.content))
    .map((chunk) => ({
      chunk,
      score: getSourceSpecificSignalScore(chunk.content)
    }))
    .sort((a, b) => b.score - a.score)[0];

  if (!bestChunk || bestChunk.score <= 0) {
    return null;
  }

  return extractQuerySnippet(bestChunk.chunk.content, "narrow_source_specific");
}

async function getRandomChunkSnippet(params: {
  documentIds: string[];
  strategy?: RetryStrategy;
  excludeChunkIds?: string[];
}) {
  if (params.documentIds.length === 0) return "core concepts";
  const strategy = params.strategy ?? "default";
  const ids = Prisma.join(params.documentIds);
  const excludeChunkIds = params.excludeChunkIds ?? [];
  const sampleLimit = strategy === "narrow_source_specific" ? 24 : 12;
  const chunks =
    excludeChunkIds.length > 0
      ? await prisma.$queryRaw<RetrievalChunk[]>`
          SELECT "id", "documentId", "content", "page", "chunkIndex"
          FROM "DocumentChunk"
          WHERE "documentId" IN (${ids}) AND "id" NOT IN (${Prisma.join(excludeChunkIds)})
          ORDER BY random()
          LIMIT ${sampleLimit}
        `
      : await prisma.$queryRaw<RetrievalChunk[]>`
          SELECT "id", "documentId", "content", "page", "chunkIndex"
          FROM "DocumentChunk"
          WHERE "documentId" IN (${ids})
          ORDER BY random()
          LIMIT ${sampleLimit}
        `;
  const chunk = chunks
    .filter((candidate) => !getNonEducationalChunkReason(candidate.content))
    .map((candidate) => ({
      chunk: candidate,
      score:
        getEducationalChunkScore(candidate.content) +
        (strategy === "narrow_source_specific"
          ? getSourceSpecificSignalScore(candidate.content) * 3
          : 0)
    }))
    .sort((a, b) => b.score - a.score)[0]?.chunk;

  if (!chunk && chunks.length > 0) {
    logger.info(
      {
        documentCount: params.documentIds.length,
        sampledChunkCount: chunks.length,
        strategy
      },
      "Random retrieval seed fell back because sampled chunks looked non-educational"
    );
  }

  return chunk ? extractQuerySnippet(chunk.content, strategy) : "core concepts and key principles";
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
    return { assumedBackgroundLevel: "generalist" };
  }

  const schemaJson = toStyleProfileObject(styleProfile.schemaJson);
  const assumedBackgroundLevel = normalizeAssumedBackgroundLevel(schemaJson.assumedBackgroundLevel);

  return {
    ...schemaJson,
    assumedBackgroundLevel,
    profileName: styleProfile.name,
    ...(styleProfile.instructionsText
      ? {
          explicitUserInstructions: styleProfile.instructionsText
        }
      : {})
  };
}

function shouldRefreshRetrievalAfterVerifierFailure(params: {
  reason: string;
  failureCodes?: string[];
}) {
  const normalized = params.reason.trim().toLowerCase();
  const failureCodes = new Set(params.failureCodes ?? []);
  if (!normalized) {
    return true;
  }

  if (isOutsiderStyleRejection(params)) {
    return true;
  }

  if (normalized.startsWith("verifier returned")) {
    return false;
  }

  if (
    failureCodes.has("UNSUPPORTED_ANSWER") ||
    failureCodes.has("UNSUPPORTED_RATIONALE") ||
    failureCodes.has("AMBIGUOUS_QUESTION") ||
    failureCodes.has("MULTIPLE_POSSIBLE_ANSWERS") ||
    failureCodes.has("WEAK_DISTRACTORS") ||
    failureCodes.has("INVALID_TRUE_FALSE") ||
    failureCodes.has("MISSING_CITATIONS") ||
    failureCodes.has("BAD_CITATION_LINKAGE") ||
    failureCodes.has("INVALID_STRUCTURE")
  ) {
    return false;
  }

  return true;
}

function isOutsiderStyleRejection(params: { reason: string; failureCodes?: string[] }) {
  const normalized = params.reason.trim().toLowerCase();
  const failureCodes = new Set(params.failureCodes ?? []);

  if (!failureCodes.has("LOW_EDUCATIONAL_VALUE")) {
    return false;
  }

  if (
    /metadata|document structure|table of contents|author (?:name|qualification|affiliation|biography)|bibliograph|reference list|copyright|publisher|document formatting/.test(
      normalized
    )
  ) {
    return false;
  }

  return (
    /background knowledge|field[- ]general|general knowledge|headline|summary|telegraph|without reading|specific material|specific source|cited source|too basic|too general|widely known/.test(
      normalized
    ) ||
    failureCodes.has("INVALID_TRUE_FALSE") ||
    failureCodes.has("WEAK_DISTRACTORS")
  );
}

function logTargetedVerifierRejection(params: {
  ownerId: string;
  questionType: QuestionTypeName;
  attempt: number;
  reason: string;
  failureCodes?: string[];
  assumedBackgroundLevel: AssumedBackgroundLevel;
}) {
  const failureCodes = new Set(params.failureCodes ?? []);
  const reason = params.reason.toLowerCase();
  const baseLog = {
    ownerId: params.ownerId,
    questionType: params.questionType,
    attempt: params.attempt,
    failureCodes: [...failureCodes],
    reason: params.reason,
    assumedBackgroundLevel: params.assumedBackgroundLevel,
    primaryFailureCode: params.failureCodes?.[0] ?? "UNKNOWN"
  };

  logger.info(baseLog, "Verifier rejection bucket");

  if (
    failureCodes.has("UNSUPPORTED_ANSWER") ||
    failureCodes.has("MULTIPLE_POSSIBLE_ANSWERS") ||
    failureCodes.has("AMBIGUOUS_QUESTION")
  ) {
    logger.info(baseLog, "Verifier rejected ambiguous or weakly supported answer key");
  }

  if (failureCodes.has("WEAK_DISTRACTORS") || failureCodes.has("MULTIPLE_POSSIBLE_ANSWERS")) {
    logger.info(baseLog, "Verifier rejected MCQ because a distractor remained too defensible");
  }

  if (failureCodes.has("UNSUPPORTED_RATIONALE") || failureCodes.has("BAD_CITATION_LINKAGE")) {
    logger.info(baseLog, "Verifier rejected explanation or citation alignment");
  }

  if (
    /(?:better|best|earlier|faster|inferior|less|more|preferred|safer|superior|versus|worse)/.test(
      reason
    ) &&
    (failureCodes.has("UNSUPPORTED_ANSWER") ||
      failureCodes.has("UNSUPPORTED_RATIONALE") ||
      failureCodes.has("AMBIGUOUS_QUESTION"))
  ) {
    logger.info(baseLog, "Verifier rejected unsupported comparative distinction");
  }

  if (
    failureCodes.has("LOW_EDUCATIONAL_VALUE") &&
    /(?:background knowledge|field[- ]general|general knowledge|headline|outsider|summary|telegraph|without reading|widely known|too general)/.test(
      reason
    )
  ) {
    logger.info(baseLog, "Verifier rejected question that failed the outsider test");
  }
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
  const assumedBackgroundLevel = normalizeAssumedBackgroundLevel(
    generationStyleProfile.assumedBackgroundLevel
  );

  const typeSlots = buildTypeSlots(params.count, params.typeMix ?? null, profileDistribution);

  const results = [] as { questionId?: string; status: string; reason?: string }[];

  for (let i = 0; i < params.count; i += 1) {
    const questionType = typeSlots[i] ?? "MCQ";
    let saved = false;
    let reason = "";
    let retryMode: RetryMode = "initial_retrieval";
    let retryStrategy: RetryStrategy = "default";
    let currentQuery = "";
    let currentChunks: RetrievalChunk[] = [];
    let maxAttempts = MAX_RETRIES;
    let outsiderRetryBonusGranted = false;
    let narrowRetryReason: string | null = null;
    let narrowRetrySourceChunks: RetrievalChunk[] = [];

    for (let attempt = 0; attempt < maxAttempts && !saved; attempt += 1) {
      if (retryMode !== "same_chunks" || currentChunks.length === 0) {
        const retrievalStartedAt = Date.now();
        const focusedRetryQuery =
          retryStrategy === "narrow_source_specific"
            ? buildNarrowRetryQuery(narrowRetrySourceChunks)
            : null;
        logger.info(
          {
            ownerId: params.ownerId,
            questionType,
            attempt: attempt + 1,
            retryMode,
            retryStrategy
          },
          "Question retrieval started"
        );
        currentQuery =
          focusedRetryQuery ??
          (await getRandomChunkSnippet({
            documentIds: params.documentIds,
            strategy: retryStrategy,
            excludeChunkIds:
              retryStrategy === "narrow_source_specific"
                ? narrowRetrySourceChunks.map((chunk) => chunk.id)
                : []
          }));
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
            retryStrategy,
            usedFocusedRetryQuery: Boolean(focusedRetryQuery),
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
            retryStrategy,
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
          retryContext:
            retryStrategy === "narrow_source_specific"
              ? {
                  strategy: retryStrategy,
                  previousFailureReason: narrowRetryReason
                }
              : undefined,
          userId: params.ownerId,
          documentId: params.documentIds.length === 1 ? params.documentIds[0] : null,
          metadata: {
            attempt: attempt + 1,
            requestedCount: params.count,
            styleProfileId: params.styleProfileId,
            retryStrategy
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
        const outsiderStyleRejection = isOutsiderStyleRejection({
          reason: verifier.reason,
          failureCodes: verifier.failureCodes
        });
        logTargetedVerifierRejection({
          ownerId: params.ownerId,
          questionType,
          attempt: attempt + 1,
          reason: verifier.reason,
          failureCodes: verifier.failureCodes,
          assumedBackgroundLevel
        });
        if (verifier.failureCodes?.includes("LOW_EDUCATIONAL_VALUE")) {
          logger.info(
            {
              ownerId: params.ownerId,
              questionType,
              attempt: attempt + 1,
              reason: verifier.reason,
              assumedBackgroundLevel
            },
            "Verifier rejected low-educational-value question"
          );
        }
        if (outsiderStyleRejection) {
          retryStrategy = "narrow_source_specific";
          narrowRetryReason = verifier.reason;
          narrowRetrySourceChunks = [...currentChunks];
          logger.info(
            {
              ownerId: params.ownerId,
              questionType,
              attempt: attempt + 1,
              reason: verifier.reason,
              retryMode: "refreshed_retrieval",
              retryStrategy
            },
            "Switching retry strategy to narrow, source-specific regeneration"
          );
        }
        if (outsiderStyleRejection && !outsiderRetryBonusGranted) {
          maxAttempts = MAX_RETRIES + OUTSIDER_RETRY_BONUS;
          outsiderRetryBonusGranted = true;
          logger.info(
            {
              ownerId: params.ownerId,
              questionType,
              attempt: attempt + 1,
              maxAttempts,
              reason: verifier.reason,
              retryStrategy
            },
            "Granting one additional retrieval attempt for outsider-style rejection"
          );
        }
        retryMode =
          outsiderStyleRejection ||
          shouldRefreshRetrievalAfterVerifierFailure({
            reason: verifier.reason,
            failureCodes: verifier.failureCodes
          })
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
