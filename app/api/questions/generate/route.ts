import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { resolveUserGenerationCaps } from "@/lib/billing/generation-limits";
import { prisma } from "@/lib/db/prisma";
import { generateQuestions, type TypeMix } from "@/lib/llm/generate";
import { enforceQuestionLimit, incrementUsage } from "@/lib/billing/usage";
import { logger } from "@/lib/observability/logger";

export async function POST(request: Request) {
  const requestStartedAt = Date.now();
  const user = await requireUserApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const documentIds: string[] = body.documentIds ?? [];
  const styleProfileId: string | null = body.styleProfileId ?? null;
  const difficulty = Math.min(5, Math.max(1, Number(body.difficulty ?? 3)));
  logger.info(
    {
      userId: user.id
    },
    "Generate questions request received"
  );

  const quotaCheckStartedAt = Date.now();
  const generationCaps = await resolveUserGenerationCaps(user.id);
  const requestedCount = Math.round(Number(body.count ?? 5));

  if (!Number.isFinite(requestedCount) || requestedCount < 1) {
    return NextResponse.json({ error: "Please choose at least one question." }, { status: 400 });
  }

  if (requestedCount > generationCaps.absoluteMaxCount) {
    return NextResponse.json(
      {
        error: `You can create up to ${generationCaps.absoluteMaxCount} questions in one run.`
      },
      { status: 400 }
    );
  }

  if (requestedCount > generationCaps.planMaxCount) {
    return NextResponse.json(
      {
        error:
          generationCaps.plan === "FREE"
            ? `You can create up to ${generationCaps.planMaxCount} questions in one run on the Free plan. Upgrade to Pro for up to ${generationCaps.proMaxCount} questions in one run.`
            : `You can create up to ${generationCaps.planMaxCount} questions in one run on your current plan.`
      },
      { status: 400 }
    );
  }

  const count = requestedCount;

  // Optional per-type counts override. Validated below if provided.
  let typeMix: TypeMix | null = null;
  if (body.typeMix && typeof body.typeMix === "object") {
    const raw = body.typeMix as Record<string, unknown>;
    const mcq = Number(raw.MCQ ?? 0);
    const sa = Number(raw.SHORT_ANSWER ?? 0);
    const tf = Number(raw.TRUE_FALSE ?? 0);
    const total = mcq + sa + tf;
    if (total > 0) {
      if (total !== count) {
        return NextResponse.json(
          {
            error:
              "The total across your selected question types must match the number of questions requested."
          },
          { status: 400 }
        );
      }
      typeMix = { MCQ: mcq, SHORT_ANSWER: sa, TRUE_FALSE: tf };
    }
  }

  const documents = await prisma.document.findMany({
    where: { id: { in: documentIds }, ownerId: user.id, status: "READY" }
  });

  if (documents.length === 0) {
    return NextResponse.json({ error: "No ready documents selected" }, { status: 400 });
  }

  try {
    await enforceQuestionLimit(user.id, count);
    logger.info(
      {
        userId: user.id,
        requestedCount: count,
        phaseDurationMs: Date.now() - quotaCheckStartedAt
      },
      "Generate questions quota check completed"
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Question limit reached";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    logger.info(
      {
        userId: user.id,
        selectedDocumentIds: documentIds,
        readyDocumentCount: documents.length,
        styleProfileId,
        difficulty,
        requestedCount: count,
        typeMix
      },
      "Generate questions request accepted"
    );

    const results = await generateQuestions({
      ownerId: user.id,
      documentIds: documents.map((doc) => doc.id),
      styleProfileId,
      difficulty,
      count,
      typeMix
    });

    const passed = results.filter((result) => result.status === "PASSED").length;
    const insufficientEvidence = results.filter(
      (result) => result.status === "INSUFFICIENT_EVIDENCE"
    ).length;
    await incrementUsage({ userId: user.id, questions: passed });
    logger.info(
      {
        userId: user.id,
        readyDocumentCount: documents.length,
        styleProfileId,
        difficulty,
        requestedCount: count,
        passedCount: passed,
        insufficientEvidenceCount: insufficientEvidence,
        typeMix,
        requestDurationMs: Date.now() - requestStartedAt
      },
      "Generate questions request completed"
    );
    return NextResponse.json({
      results,
      summary: {
        requestedCount: count,
        passedCount: passed,
        failedCount: results.length - passed
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
    logger.error(
      {
        userId: user.id,
        selectedDocumentIds: documentIds,
        styleProfileId,
        difficulty,
        requestedCount: count,
        typeMix,
        message,
        requestDurationMs: Date.now() - requestStartedAt
      },
      "Generation failed"
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
