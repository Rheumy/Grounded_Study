import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { generateQuestion, type RetrievalChunk } from "@/lib/llm/question-generator";
import { verifyQuestion } from "@/lib/llm/verifier/verifier";
import { retrieveChunks } from "@/lib/retrieval/retrieve";
import { logger } from "@/lib/observability/logger";

const MAX_RETRIES = 3;

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

export async function generateQuestions(params: {
  ownerId: string;
  documentIds: string[];
  styleProfileId: string | null;
  difficulty: number;
  count: number;
}) {
  logger.info(
    {
      ownerId: params.ownerId,
      documentCount: params.documentIds.length,
      styleProfileId: params.styleProfileId,
      difficulty: params.difficulty,
      requestedCount: params.count
    },
    "Generation started"
  );

  const styleProfile = params.styleProfileId
    ? await prisma.styleProfile.findFirst({ where: { id: params.styleProfileId, ownerId: params.ownerId } })
    : null;

  if (params.styleProfileId && !styleProfile) {
    throw new Error("Style profile not found");
  }

  const results = [] as { questionId?: string; status: string; reason?: string }[];

  for (let i = 0; i < params.count; i += 1) {
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

      const generated = await generateQuestion({
        styleProfile: styleProfile?.schemaJson ?? {},
        difficulty: params.difficulty,
        questionType: "MCQ",
        chunks
      });

      if (generated.verifierStatus === "INSUFFICIENT_EVIDENCE") {
        reason = "Insufficient evidence";
        continue;
      }

      const chunkIds = new Set(chunks.map((chunk) => chunk.id));
      const citationsValid = generated.citations.every((citation) => chunkIds.has(citation.chunkId));
      if (!citationsValid) {
        reason = "Citations reference unknown chunks";
        continue;
      }

      const verifier = await verifyQuestion({
        question: generated,
        chunks
      });

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
        { ownerId: params.ownerId, attemptIndex: i + 1, reason },
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
