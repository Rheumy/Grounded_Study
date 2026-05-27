import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";
import {
  buildFeedbackExcludedQuestionFilter,
  buildHiddenQuestionFilter,
  buildUnseenQuestionFilter,
  markQuestionsServed
} from "@/lib/questions/exposure";
import { sanitizeFeedbackText } from "@/lib/feedback/user-facing";

type ExamQuestionMix = "MCQ" | "TRUE_FALSE" | "MIXED";
const SHORT_ANSWER_BETA_MESSAGE = "Short-answer questions are not available in this beta yet.";

const NEW_QUESTION_ORDER = [
  { createdAt: "desc" },
  { id: "asc" }
] satisfies Prisma.QuestionOrderByWithRelationInput[];

export async function POST(request: Request) {
  const user = await requireUserApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const count = Math.min(50, Math.max(1, Number(body.count ?? 10)));
  const timeLimitMin = Math.min(180, Math.max(5, Number(body.timeLimitMin ?? 30)));
  const difficulty = body.difficulty ? Number(body.difficulty) : null;
  if (body.questionMix === "SHORT_ANSWER") {
    return NextResponse.json({ error: SHORT_ANSWER_BETA_MESSAGE }, { status: 400 });
  }

  const questionMix: ExamQuestionMix =
    body.questionMix === "TRUE_FALSE" || body.questionMix === "MIXED" ? body.questionMix : "MCQ";
  const hiddenQuestionIds = Array.isArray(body.hiddenQuestionIds)
    ? body.hiddenQuestionIds.filter(
        (value: unknown): value is string => typeof value === "string" && value.trim().length > 0
      )
    : [];

  const questionFilters: Prisma.QuestionWhereInput[] = [
    {
      ownerId: user.id,
      verifierStatus: "PASSED",
      ...(difficulty ? { difficulty } : {})
    },
    buildFeedbackExcludedQuestionFilter(user.id),
    buildHiddenQuestionFilter(user.id),
    buildUnseenQuestionFilter(user.id)
  ];

  if (hiddenQuestionIds.length > 0) {
    questionFilters.push({
      id: {
        notIn: hiddenQuestionIds
      }
    });
  }

  const questionSelect = {
    id: true,
    stem: true,
    type: true,
    optionsJson: true
  } satisfies Prisma.QuestionSelect;

  const questions =
    questionMix === "MIXED"
      ? [
          ...(await prisma.question.findMany({
            where: {
              AND: [
                ...questionFilters,
                {
                  type: "MCQ"
                }
              ]
            },
            orderBy: NEW_QUESTION_ORDER,
            take: Math.ceil(count / 2),
            select: questionSelect
          })),
          ...(await prisma.question.findMany({
            where: {
              AND: [
                ...questionFilters,
                {
                  type: "TRUE_FALSE"
                }
              ]
            },
            orderBy: NEW_QUESTION_ORDER,
            take: Math.floor(count / 2),
            select: questionSelect
          }))
        ]
      : await prisma.question.findMany({
          where: {
            AND: [
              ...questionFilters,
              {
                type: questionMix
              }
            ]
          },
          orderBy: NEW_QUESTION_ORDER,
          take: count,
          select: questionSelect
        });

  if (questions.length === 0) {
    return NextResponse.json(
      {
        error:
          "You have no new questions available for this selection. Generate more questions or switch to All questions."
      },
      { status: 400 }
    );
  }

  if (questions.length < count) {
    return NextResponse.json(
      {
        error: `You only have ${questions.length} new question${questions.length === 1 ? "" : "s"} available for this mock exam. Generate more questions or reduce the number of questions.`
      },
      { status: 400 }
    );
  }

  const session = await prisma.$transaction(async (tx) => {
    const createdSession = await tx.examSession.create({
      data: {
        userId: user.id,
        modeConfigJson: {
          count,
          timeLimitMin,
          difficulty,
          questionMix
        }
      }
    });

    await tx.examSessionQuestion.createMany({
      data: questions.map((question, index) => ({
        sessionId: createdSession.id,
        questionId: question.id,
        order: index + 1
      }))
    });

    await markQuestionsServed(tx, {
      userId: user.id,
      questionIds: questions.map((question) => question.id),
      mode: "EXAM"
    });

    return createdSession;
  });

  const payload = questions.map((question) => ({
    id: question.id,
    stem: sanitizeFeedbackText(question.stem),
    type: question.type,
    options: Array.isArray(question.optionsJson)
      ? (question.optionsJson as string[]).map((option) => sanitizeFeedbackText(option))
      : []
  }));

  return NextResponse.json({
    sessionId: session.id,
    timeLimitMin,
    questions: payload
  });
}
