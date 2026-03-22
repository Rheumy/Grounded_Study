import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { generateQuestion, type RetrievalChunk } from "@/lib/llm/question-generator";
import { verifyQuestion } from "@/lib/llm/verifier/verifier";
import { retrieveChunks } from "@/lib/retrieval/retrieve";
import { logger } from "@/lib/observability/logger";

const MAX_RETRIES = 3;

type QuestionTypeName = "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE";

export type TypeMix = {
  MCQ?: number;
  SHORT_ANSWER?: number;
  TRUE_FALSE?: number;
};

async function getRandomChunkSnippet(documentIds: string[]) {
  if (documentIds.length === 0) return "core concepts";
  const ids = Prisma.join(documentIds);
  const chunk = await prisma.$queryRaw<RetrievalChunk[]>`
    SELECT "id", "documentId", "content", "page", "chunkIndex"
    FROM "DocumentChunk"
    WHERE "documentId" IN (${ids})
    ORDER BY random()
    LIMIT 1
  `;
  return chunk[0]?.content?.slice(0, 200) ?? "core concepts";
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

  const typeSlots = buildTypeSlots(params.count, params.typeMix ?? null, profileDistribution);

  const results = [] as { questionId?: string; status: string; reason?: string }[];

  for (let i = 0; i < params.count; i += 1) {
    const questionType = typeSlots[i] ?? "MCQ";
    let saved = false;
    let reason = "";

    for (let attempt = 0; attempt < MAX_RETRIES && !saved; attempt += 1) {
      const query = await getRandomChunkSnippet(params.documentIds);
      const chunks = await retrieveChunks({
        query,
        documentIds: params.documentIds,
        limit: 6
      });

      if (chunks.length === 0) {
        reason = "No chunks available";
        continue;
      }

      let generated;
      try {
        generated = await generateQuestion({
          styleProfile: styleProfile?.schemaJson ?? {},
          difficulty: params.difficulty,
          questionType,
          chunks
        });
      } catch (genError) {
        // Log the raw error (e.g. Zod validation failure on LLM output) and retry
        logger.warn(
          {
            ownerId: params.ownerId,
            questionType,
            attempt,
            error: genError instanceof Error ? genError.message : String(genError)
          },
          "generateQuestion threw — likely malformed LLM output, retrying"
        );
        reason = "Question generation produced an invalid response";
        continue;
      }

      if (generated.verifierStatus === "INSUFFICIENT_EVIDENCE") {
        reason = "Insufficient evidence";
        continue;
      }

      const chunkIds = new Set(chunks.map((chunk) => chunk.id));
      const citationsValid = generated.citations.every((citation) =>
        chunkIds.has(citation.chunkId)
      );
      if (!citationsValid) {
        reason = "Citations reference unknown chunks";
        continue;
      }

      let verifier;
      try {
        verifier = await verifyQuestion({
          question: generated,
          chunks
        });
      } catch (verifyError) {
        logger.warn(
          {
            ownerId: params.ownerId,
            questionType,
            attempt,
            error: verifyError instanceof Error ? verifyError.message : String(verifyError)
          },
          "verifyQuestion threw — treating as FAILED, retrying"
        );
        reason = "Verification step failed unexpectedly";
        continue;
      }

      if (verifier.status === "FAILED") {
        reason = verifier.reason;
        continue;
      }

      const record = await prisma.question.create({
        data: {
          ownerId: params.ownerId,
          styleProfileId: params.styleProfileId,
          difficulty: generated.difficulty,
          type: generated.type,
          stem: generated.stem,
          optionsJson: generated.options ?? undefined,
          answer: generated.answer,
          rationale: generated.rationale,
          citationsJson: generated.citations,
          verifierStatus: "PASSED",
          tagsJson: generated.tags ?? undefined
        }
      });

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
