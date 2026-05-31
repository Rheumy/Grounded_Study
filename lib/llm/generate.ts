import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { generateQuestion } from "@/lib/llm/question-generator";
import {
  normalizeAssumedBackgroundLevel,
  type AssumedBackgroundLevel
} from "@/lib/llm/schemas/style-profile";
import type { QuestionStylePreset } from "@/lib/llm/presets";
import { verifyQuestion } from "@/lib/llm/verifier/verifier";
import {
  getEducationalChunkScore,
  getNonEducationalChunkReason,
  retrieveChunks,
  type RetrievedChunk
} from "@/lib/retrieval/retrieve";
import { logger } from "@/lib/observability/logger";
import { sanitizeFeedbackText } from "@/lib/feedback/user-facing";

const MAX_RETRIES = 3;
const OUTSIDER_RETRY_BONUS = 1;
const SHORT_ANSWER_BETA_MESSAGE = "Short-answer questions are not available in this beta yet.";

type QuestionTypeName = "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE";
type RetryMode = "initial_retrieval" | "same_chunks" | "refreshed_retrieval";
type RetryStrategy = "default" | "narrow_source_specific" | "type_correction";

function durationMs(startedAt: number): number {
  return Date.now() - startedAt;
}

export type TypeMix = {
  MCQ?: number;
  SHORT_ANSWER?: number;
  TRUE_FALSE?: number;
};

export type GenerationProgressEvent =
  | { phase: "retrieving"; questionNumber: number; totalQuestions: number }
  | { phase: "generating"; questionNumber: number; totalQuestions: number }
  | { phase: "verifying"; questionNumber: number; totalQuestions: number }
  | { phase: "saving"; questionNumber: number; totalQuestions: number }
  | { phase: "saved"; questionNumber: number; totalQuestions: number; passedCount: number };

export type GenerationProgressHandler = (event: GenerationProgressEvent) => void | Promise<void>;

function countMatches(value: string, pattern: RegExp): number {
  const matches = value.match(pattern);
  return matches ? matches.length : 0;
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildChunkUsageRows(params: {
  ownerId: string;
  questionId: string;
  citations: { chunkId: string }[];
  chunks: RetrievedChunk[];
}) {
  const documentIdByChunkId = new Map(params.chunks.map((chunk) => [chunk.id, chunk.documentId]));

  return [...new Set(params.citations.map((citation) => citation.chunkId))]
    .map((chunkId) => {
      const documentId = documentIdByChunkId.get(chunkId);

      if (!documentId) {
        return null;
      }

      return {
        userId: params.ownerId,
        documentId,
        chunkId,
        questionId: params.questionId
      };
    })
    .filter(
      (
        row
      ): row is {
        userId: string;
        documentId: string;
        chunkId: string;
        questionId: string;
      } => row !== null
    );
}

function getSourceSpecificSignalScore(content: string): number {
  const normalized = normalizeSpace(content).toLowerCase();

  if (!normalized || getNonEducationalChunkReason(content)) {
    return 0;
  }

  return (
    countMatches(
      normalized,
      /\b(?:after|although|before|compared with|compared to|despite|except|however|if|in contrast|instead|less than|more than|only if|only when|prior to|rather than|relative to|subsequent|then|unless|versus|when|whereas|within|without)\b/g
    ) * 2 +
    countMatches(
      normalized,
      /\b(?:caveat|component|condition|contraindication|criteria|criterion|exception|implication|limitation|order|prerequisite|required|requirement|sequence|step|threshold|timing)\b/g
    ) * 2 +
    countMatches(normalized, /\b(?:first|second|third|final|initial|next)\b/g) +
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
    /\b(?:after|although|before|caveat|compared with|compared to|component|condition|contraindication|criteria|criterion|exception|first|however|if|implication|initial|limitation|next|only if|only when|order|prerequisite|prior to|required|requirement|sequence|step|subsequent|then|threshold|timing|unless|versus|vs\.?|when|whereas|within|\d+(?:\.\d+)?(?:%|x)?)\b/;
  const match = focusPattern.exec(normalized);

  if (!match) {
    return collapsed.slice(0, 220);
  }

  const start = Math.max(0, match.index - 90);
  return collapsed.slice(start, start + 220);
}

function buildNarrowRetryQuery(sourceChunks: RetrievedChunk[]): string | null {
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

function rankChunksForRetry(chunks: RetrievedChunk[]): RetrievedChunk[] {
  return [...chunks].sort((left, right) => {
    const leftScore =
      getSourceSpecificSignalScore(left.content) * 3 + getEducationalChunkScore(left.content);
    const rightScore =
      getSourceSpecificSignalScore(right.content) * 3 + getEducationalChunkScore(right.content);

    return rightScore - leftScore;
  });
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
      ? await prisma.$queryRaw<RetrievedChunk[]>`
          SELECT "id", "documentId", "content", "page", "chunkIndex"
          FROM "DocumentChunk"
          WHERE "documentId" IN (${ids}) AND "id" NOT IN (${Prisma.join(excludeChunkIds)})
          ORDER BY random()
          LIMIT ${sampleLimit}
        `
      : await prisma.$queryRaw<RetrievedChunk[]>`
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
export function buildTypeSlots(
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
    shortAnswerCount = 0;
    trueFalseCount = typeMix.TRUE_FALSE ?? 0;
  } else if (profileDistribution) {
    // Infer from profile weights via proportional rounding
    const mcqW = profileDistribution.MCQ ?? 0;
    const saW = 0;
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
  presetStyleProfile?: QuestionStylePreset | null;
  difficulty: number;
  count: number;
  typeMix?: TypeMix | null;
  onProgress?: GenerationProgressHandler;
}) {
  logger.info(
    {
      ownerId: params.ownerId,
      documentCount: params.documentIds.length,
      styleProfileId: params.styleProfileId,
      presetKey: params.presetStyleProfile?.key ?? null,
      difficulty: params.difficulty,
      requestedCount: params.count,
      typeMix: params.typeMix ?? null
    },
    "Generation started"
  );

  const styleProfile = params.presetStyleProfile
    ? null
    : params.styleProfileId
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
  const presetDistribution = params.presetStyleProfile?.styleProfile.questionTypeDistribution ?? null;
  const profileDistribution = presetDistribution ?? profileSchema?.questionTypeDistribution ?? null;
  if ((params.typeMix?.SHORT_ANSWER ?? 0) > 0) {
    throw new Error(SHORT_ANSWER_BETA_MESSAGE);
  }
  if (!params.typeMix && (profileDistribution?.SHORT_ANSWER ?? 0) > 0) {
    throw new Error(SHORT_ANSWER_BETA_MESSAGE);
  }

  const generationStyleProfile = params.presetStyleProfile
    ? buildGenerationStyleProfile({
        name: params.presetStyleProfile.label,
        schemaJson: params.presetStyleProfile.styleProfile as Prisma.JsonValue,
        instructionsText: null
      })
    : buildGenerationStyleProfile(styleProfile);
  const assumedBackgroundLevel = normalizeAssumedBackgroundLevel(
    generationStyleProfile.assumedBackgroundLevel
  );

  const typeSlots = buildTypeSlots(params.count, params.typeMix ?? null, profileDistribution);
  const resolvedTypeCounts = typeSlots.reduce(
    (counts, questionType) => ({
      ...counts,
      [questionType]: counts[questionType] + 1
    }),
    { MCQ: 0, SHORT_ANSWER: 0, TRUE_FALSE: 0 } satisfies Record<QuestionTypeName, number>
  );
  logger.info(
    {
      ownerId: params.ownerId,
      requestedCount: params.count,
      resolvedTypeCounts
    },
    "Generation question type slots resolved"
  );

  const results = [] as { questionId?: string; status: string; reason?: string }[];
  const savedTypeCounts: Record<QuestionTypeName, number> = {
    MCQ: 0,
    SHORT_ANSWER: 0,
    TRUE_FALSE: 0
  };

  for (let i = 0; i < params.count; i += 1) {
    const questionType = typeSlots[i] ?? "MCQ";
    let saved = false;
    let reason = "";
    let retryMode: RetryMode = "initial_retrieval";
    let retryStrategy: RetryStrategy = "default";
    let currentQuery = "";
    let currentChunks: RetrievedChunk[] = [];
    let maxAttempts = MAX_RETRIES;
    let outsiderRetryBonusGranted = false;
    let narrowRetryReason: string | null = null;
    let narrowRetrySourceChunks: RetrievedChunk[] = [];

    for (let attempt = 0; attempt < maxAttempts && !saved; attempt += 1) {
      if (retryMode !== "same_chunks" || currentChunks.length === 0) {
        const retrievalStartedAt = Date.now();
        await params.onProgress?.({
          phase: "retrieving",
          questionNumber: i + 1,
          totalQuestions: params.count
        });
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
        if (retryStrategy === "narrow_source_specific" && currentChunks.length > 1) {
          currentChunks = rankChunksForRetry(currentChunks);
          logger.info(
            {
              ownerId: params.ownerId,
              questionType,
              attempt: attempt + 1,
              retryMode,
              retryStrategy,
              chunkCount: currentChunks.length
            },
            "Ranked retrieval chunks for narrow, source-specific retry"
          );
        }
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
        await params.onProgress?.({
          phase: "generating",
          questionNumber: i + 1,
          totalQuestions: params.count
        });
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
            retryStrategy !== "default"
              ? {
                  strategy: retryStrategy,
                  previousFailureReason:
                    retryStrategy === "narrow_source_specific" ? narrowRetryReason : reason
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
            returnedQuestionType: generated.type,
            attempt: attempt + 1,
            retryMode,
            phaseDurationMs: durationMs(generationStartedAt)
          },
          "Question LLM generation completed"
        );
      } catch (genError) {
        const generationErrorMessage =
          genError instanceof Error ? genError.message : String(genError);

        // Log the raw error (e.g. Zod validation failure on LLM output) and retry
        logger.warn(
          {
            ownerId: params.ownerId,
            questionType,
            attempt: attempt + 1,
            retryMode: "same_chunks",
            error: generationErrorMessage
          },
          "generateQuestion threw — retrying with same chunks"
        );
        if (/citation/i.test(generationErrorMessage)) {
          logger.info(
            {
              ownerId: params.ownerId,
              questionType,
              attempt: attempt + 1,
              failureBucket: "BAD_CITATION_LINKAGE",
              retryMode: "same_chunks"
            },
            "Generation rejected citation mismatch before verifier"
          );
        }
        reason =
          genError instanceof Error
            ? `Question generation failed: ${genError.message}`
            : "Question generation produced an invalid response";
        retryMode = "same_chunks";
        continue;
      }

      if (generated.verifierStatus === "INSUFFICIENT_EVIDENCE") {
        reason = "Insufficient evidence";
        retryMode = "refreshed_retrieval";
        continue;
      }

      if (generated.type !== questionType) {
        reason = `Generated ${generated.type} when ${questionType} was requested`;
        retryMode = "same_chunks";
        retryStrategy = "type_correction";
        logger.warn(
          {
            ownerId: params.ownerId,
            requestedQuestionType: questionType,
            generatedQuestionType: generated.type,
            attempt: attempt + 1,
            typeMismatchRetryCount: attempt + 1,
            retryMode
          },
          "Generated question type did not match requested slot"
        );
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
        await params.onProgress?.({
          phase: "verifying",
          questionNumber: i + 1,
          totalQuestions: params.count
        });
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
        reason =
          verifyError instanceof Error
            ? `Verification failed: ${verifyError.message}`
            : "Verification step failed unexpectedly";
        retryMode = "same_chunks";
        continue;
      }

      if (verifier.status === "FAILED") {
        reason = verifier.reason;
        logger.info(
          {
            ownerId: params.ownerId,
            questionType,
            attempt: attempt + 1,
            failureCodes: verifier.failureCodes ?? [],
            reason: verifier.reason
          },
          "Verifier rejected generated question"
        );
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
              failureCodes: verifier.failureCodes,
              reason: verifier.reason,
              assumedBackgroundLevel,
              lowEducationalValueBucket: /near-copy|source wording|verbatim|restatement|copied/i.test(
                verifier.reason
              )
                ? "near_copy_or_restatement"
                : /headline|summary|broad|field[- ]general|background|without reading|without studying/i.test(
                      verifier.reason
                    )
                  ? "outsider_or_broad_summary"
                  : /telegraph|guess|wording/i.test(verifier.reason)
                    ? "telegraphed_or_guessable"
                    : "other"
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
      await params.onProgress?.({
        phase: "saving",
        questionNumber: i + 1,
        totalQuestions: params.count
      });
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
          optionsJson: generated.options?.map((option) => sanitizeFeedbackText(option)) ?? undefined,
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

      const chunkUsageRows = buildChunkUsageRows({
        ownerId: params.ownerId,
        questionId: record.id,
        citations: generated.citations,
        chunks: currentChunks
      });

      if (chunkUsageRows.length > 0) {
        try {
          await prisma.chunkUsage.createMany({
            data: chunkUsageRows
          });
        } catch (chunkUsageError) {
          logger.warn(
            {
              ownerId: params.ownerId,
              questionId: record.id,
              questionType,
              trackedChunkCount: chunkUsageRows.length,
              error:
                chunkUsageError instanceof Error
                  ? chunkUsageError.message
                  : String(chunkUsageError)
            },
            "Question saved but chunk usage tracking failed"
          );
        }
      }

      results.push({ questionId: record.id, status: "PASSED" });
      savedTypeCounts[questionType] += 1;
      await params.onProgress?.({
        phase: "saved",
        questionNumber: i + 1,
        totalQuestions: params.count,
        passedCount: results.filter((result) => result.status === "PASSED").length
      });
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
      failedCount: failed,
      savedTypeCounts
    },
    "Generation completed"
  );

  return results;
}
