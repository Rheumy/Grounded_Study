import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { resolveUserGenerationCaps } from "@/lib/billing/generation-limits";
import { prisma } from "@/lib/db/prisma";
import { type TypeMix } from "@/lib/llm/generate";
import { resolvePreset } from "@/lib/llm/presets";
import { enforceQuestionLimit } from "@/lib/billing/usage";
import { logger } from "@/lib/observability/logger";
import { normalizeQuestionType, type QuestionType } from "@/lib/constants/question-types";

const SHORT_ANSWER_BETA_MESSAGE = "Short-answer questions are not available in this beta yet.";
const QUESTION_TYPE_ERROR =
  "Choose Multiple choice, True/false, or both before generating questions.";

function buildSingleTypeMix(questionType: QuestionType, count: number): TypeMix {
  return {
    MCQ: questionType === "MCQ" ? count : 0,
    SHORT_ANSWER: questionType === "SHORT_ANSWER" ? count : 0,
    TRUE_FALSE: questionType === "TRUE_FALSE" ? count : 0
  };
}

function parseRequestedTypeMix(body: Record<string, unknown>, count: number): TypeMix | null {
  if (body.typeMix !== undefined) {
    if (!body.typeMix || typeof body.typeMix !== "object" || Array.isArray(body.typeMix)) {
      throw new Error(QUESTION_TYPE_ERROR);
    }

    const raw = body.typeMix as Record<string, unknown>;
    const hasKnownTypeKey = ["MCQ", "SHORT_ANSWER", "TRUE_FALSE"].some((key) =>
      Object.prototype.hasOwnProperty.call(raw, key)
    );
    if (!hasKnownTypeKey) {
      throw new Error(QUESTION_TYPE_ERROR);
    }

    const mcq = Math.round(Number(raw.MCQ ?? 0));
    const sa = Math.round(Number(raw.SHORT_ANSWER ?? 0));
    const tf = Math.round(Number(raw.TRUE_FALSE ?? 0));

    if (![mcq, sa, tf].every((value) => Number.isFinite(value) && value >= 0)) {
      throw new Error("Question type counts must be zero or greater.");
    }

    if (sa > 0) {
      throw new Error(SHORT_ANSWER_BETA_MESSAGE);
    }

    const total = mcq + sa + tf;
    if (total <= 0) {
      throw new Error(QUESTION_TYPE_ERROR);
    }

    if (total !== count) {
      throw new Error(
        "The total across your selected question types must match the number of questions requested."
      );
    }

    return { MCQ: mcq, SHORT_ANSWER: sa, TRUE_FALSE: tf };
  }

  const rawQuestionType = body.questionType ?? body.type;
  if (rawQuestionType !== undefined) {
    const questionType = normalizeQuestionType(rawQuestionType);
    if (!questionType) {
      throw new Error(QUESTION_TYPE_ERROR);
    }
    return buildSingleTypeMix(questionType, count);
  }

  return null;
}

export async function POST(request: Request) {
  const user = await requireUserApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const documentIds: string[] = body.documentIds ?? [];
  const styleProfileId: string | null = body.styleProfileId ?? null;
  const presetKey =
    typeof body.presetKey === "string" && body.presetKey.trim().length > 0
      ? body.presetKey.trim()
      : null;
  const difficulty = Math.min(5, Math.max(1, Number(body.difficulty ?? 3)));

  const bodyRecord = body as Record<string, unknown>;
  const requestedQuestionType = normalizeQuestionType(bodyRecord.questionType ?? bodyRecord.type);

  if (requestedQuestionType === "SHORT_ANSWER" || presetKey === "standard_short_answer") {
    return NextResponse.json({ error: SHORT_ANSWER_BETA_MESSAGE }, { status: 400 });
  }

  if (presetKey && styleProfileId) {
    return NextResponse.json(
      { error: "Provide either a preset or a saved profile, not both" },
      { status: 400 }
    );
  }

  const resolvedPreset = styleProfileId || !presetKey ? null : resolvePreset(presetKey);

  if (presetKey && !resolvedPreset) {
    return NextResponse.json({ error: "Unknown question style preset" }, { status: 400 });
  }

  logger.info(
    {
      userId: user.id,
      styleProfileId,
      presetKey: resolvedPreset?.key ?? presetKey
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

  let typeMix: TypeMix | null;
  try {
    typeMix = parseRequestedTypeMix(bodyRecord, count);
  } catch (error) {
    const message = error instanceof Error ? error.message : QUESTION_TYPE_ERROR;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!typeMix && !resolvedPreset && !styleProfileId) {
    return NextResponse.json({ error: QUESTION_TYPE_ERROR }, { status: 400 });
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
        presetKey: resolvedPreset?.key ?? null,
        difficulty,
        requestedCount: count,
        requestedQuestionType: requestedQuestionType ?? null,
        typeMix
      },
      "Generate questions request accepted"
    );

    const job = await prisma.generationJob.create({
      data: {
        userId: user.id,
        documentIds: documents.map((doc) => doc.id),
        styleProfileId,
        presetKey: resolvedPreset?.key ?? null,
        difficulty,
        requestedCount: count,
        typeMix: typeMix ?? Prisma.JsonNull,
        status: "PENDING",
        passedCount: 0,
        currentPhase: "Waiting to start"
      }
    });

    logger.info(
      {
        userId: user.id,
        jobId: job.id,
        status: job.status,
        readyDocumentCount: documents.length,
        styleProfileId,
        presetKey: resolvedPreset?.key ?? null,
        difficulty,
        requestedCount: count,
        requestedQuestionType: requestedQuestionType ?? null,
        typeMix
      },
      "Generation job created"
    );
    logger.info({ jobId: job.id, status: job.status }, `Job transitioned to status ${job.status}`);

    return NextResponse.json({ jobId: job.id }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
    logger.error(
      {
        userId: user.id,
        selectedDocumentIds: documentIds,
        styleProfileId,
        presetKey: resolvedPreset?.key ?? null,
        difficulty,
        requestedCount: count,
        typeMix,
        message
      },
      "Generation job queueing failed"
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
