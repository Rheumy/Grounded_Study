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

const QUESTION_TYPES = ["MCQ", "SHORT_ANSWER", "TRUE_FALSE"] as const;
const RECYCLE_MODES = ["NONE", "DUE", "INCORRECT", "ALL"] as const;

type QuestionTypeFilter = (typeof QUESTION_TYPES)[number] | "ALL";
type RecycleMode = (typeof RECYCLE_MODES)[number];

const NEW_QUESTION_ORDER = [
  { createdAt: "desc" },
  { id: "asc" }
] satisfies Prisma.QuestionOrderByWithRelationInput[];

type PracticeQuestionDto = {
  id: string;
  stem: string;
  type: "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE";
  optionsJson: string[] | null;
  difficulty: number;
  tagsJson: unknown;
  userFeedback: {
    label: "EASY" | "HARD" | "GOOD_QUESTION" | "DISPUTED_INCORRECT" | "IRRELEVANT";
    comment: string | null;
  } | null;
};

function parseQuestionType(value: string | null): QuestionTypeFilter {
  if (value && QUESTION_TYPES.includes(value as (typeof QUESTION_TYPES)[number])) {
    return value as QuestionTypeFilter;
  }

  return "ALL";
}

function parseRecycleMode(value: string | null): RecycleMode {
  if (value && RECYCLE_MODES.includes(value as RecycleMode)) {
    return value as RecycleMode;
  }

  return "NONE";
}

function pickRandomQuestion<T>(questions: T[]): T | null {
  if (questions.length === 0) return null;
  return questions[Math.floor(Math.random() * questions.length)] ?? null;
}

function buildEmptyMessage(questionType: QuestionTypeFilter, recycleMode: RecycleMode): string {
  const typeLabel =
    questionType === "ALL"
      ? "practice"
      : questionType === "SHORT_ANSWER"
        ? "short-answer"
        : questionType === "TRUE_FALSE"
          ? "true/false"
          : "multiple-choice";

  if (recycleMode === "DUE") {
    return `No due ${typeLabel} questions are available right now.`;
  }

  if (recycleMode === "INCORRECT") {
    return `You have no prior incorrect ${typeLabel} questions available for this selection right now.`;
  }

  if (recycleMode === "ALL") {
    return `No ${typeLabel} questions are available right now.`;
  }

  return "You have no new questions available for this selection. Generate more questions or switch to All questions.";
}

function buildPracticeQuestionSelect(userId: string) {
  return {
    id: true,
    stem: true,
    type: true,
    optionsJson: true,
    difficulty: true,
    tagsJson: true,
    questionFeedbacks: {
      where: { userId },
      take: 1,
      orderBy: { updatedAt: "desc" },
      select: {
        label: true,
        comment: true
      }
    }
  } satisfies Prisma.QuestionSelect;
}

function toPracticeQuestionDto(question: {
  id: string;
  stem: string;
  type: "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE";
  optionsJson: unknown;
  difficulty: number;
  tagsJson: unknown;
  questionFeedbacks: Array<{
    label: "EASY" | "HARD" | "GOOD_QUESTION" | "DISPUTED_INCORRECT" | "IRRELEVANT";
    comment: string | null;
  }>;
}): PracticeQuestionDto {
  const latestFeedback = question.questionFeedbacks[0] ?? null;

  return {
    id: question.id,
    stem: question.stem,
    type: question.type,
    optionsJson: Array.isArray(question.optionsJson) ? (question.optionsJson as string[]) : null,
    difficulty: question.difficulty,
    tagsJson: question.tagsJson ?? null,
    userFeedback: latestFeedback
  };
}

function buildIncorrectQuestionFilter(userId: string): Prisma.QuestionWhereInput {
  return {
    OR: [
      {
        practiceAttempts: {
          some: {
            userId,
            correct: false
          }
        }
      },
      {
        examSessionQuestions: {
          some: {
            session: {
              userId
            },
            selectedAnswer: {
              not: null
            },
            correct: false
          }
        }
      }
    ]
  };
}

function buildQuestionWhere(filters: Prisma.QuestionWhereInput[]): Prisma.QuestionWhereInput {
  if (filters.length === 1) {
    return filters[0] ?? {};
  }

  return {
    AND: filters
  };
}

export async function GET(request: Request) {
  const user = await requireUserApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const questionType = parseQuestionType(searchParams.get("questionType"));
  const recycleMode = parseRecycleMode(searchParams.get("recycleMode"));
  const excludeQuestionIds = searchParams.getAll("excludeQuestionId").filter(Boolean);
  const hiddenQuestionIds = searchParams.getAll("hiddenQuestionId").filter(Boolean);
  const practiceQuestionSelect = buildPracticeQuestionSelect(user.id);
  const baseFilters: Prisma.QuestionWhereInput[] = [
    {
      ownerId: user.id,
      verifierStatus: "PASSED",
      ...(questionType !== "ALL" ? { type: questionType } : {})
    }
  ];
  const browserHiddenQuestionFilter =
    hiddenQuestionIds.length > 0
      ? [
          {
            id: {
              notIn: hiddenQuestionIds
            }
          } satisfies Prisma.QuestionWhereInput
        ]
      : [];
  const sessionExclusionFilters =
    excludeQuestionIds.length > 0
      ? [
          {
            id: {
              notIn: excludeQuestionIds
            }
          } satisfies Prisma.QuestionWhereInput
        ]
      : [];

  let question:
    | {
        id: string;
        stem: string;
        type: "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE";
        optionsJson: unknown;
        difficulty: number;
        tagsJson: unknown;
        questionFeedbacks: Array<{
          label: "EASY" | "HARD" | "GOOD_QUESTION" | "DISPUTED_INCORRECT" | "IRRELEVANT";
          comment: string | null;
        }>;
      }
    | null = null;

  if (recycleMode === "DUE") {
    const due = await prisma.spacedRepetitionSchedule.findMany({
      where: {
        userId: user.id,
        dueAt: { lte: new Date() },
        question: buildQuestionWhere([
          ...baseFilters,
          ...browserHiddenQuestionFilter,
          ...sessionExclusionFilters,
          buildFeedbackExcludedQuestionFilter(user.id),
          buildHiddenQuestionFilter(user.id)
        ])
      },
      select: { question: { select: practiceQuestionSelect } },
      orderBy: { dueAt: "asc" },
      take: 50
    });

    question = pickRandomQuestion(due.map((item) => item.question));
  } else if (recycleMode === "INCORRECT") {
    const candidates = await prisma.question.findMany({
      where: buildQuestionWhere([
        ...baseFilters,
        ...browserHiddenQuestionFilter,
        ...sessionExclusionFilters,
        buildFeedbackExcludedQuestionFilter(user.id),
        buildHiddenQuestionFilter(user.id),
        buildIncorrectQuestionFilter(user.id)
      ]),
      select: practiceQuestionSelect,
      take: 200
    });

    question = pickRandomQuestion(candidates);
  } else if (recycleMode === "ALL") {
    let candidates = await prisma.question.findMany({
      where: buildQuestionWhere([
        ...baseFilters,
        ...browserHiddenQuestionFilter,
        ...sessionExclusionFilters,
        buildFeedbackExcludedQuestionFilter(user.id),
        buildHiddenQuestionFilter(user.id)
      ]),
      select: practiceQuestionSelect,
      take: 200
    });

    if (candidates.length === 0 && sessionExclusionFilters.length > 0) {
      candidates = await prisma.question.findMany({
        where: buildQuestionWhere([
          ...baseFilters,
          ...browserHiddenQuestionFilter,
          buildFeedbackExcludedQuestionFilter(user.id),
          buildHiddenQuestionFilter(user.id)
        ]),
        select: practiceQuestionSelect,
        take: 200
      });
    }

    question = pickRandomQuestion(candidates);
  } else {
    question = await prisma.question.findFirst({
      where: buildQuestionWhere([
        ...baseFilters,
        ...browserHiddenQuestionFilter,
        ...sessionExclusionFilters,
        buildFeedbackExcludedQuestionFilter(user.id),
        buildHiddenQuestionFilter(user.id),
        buildUnseenQuestionFilter(user.id)
      ]),
      select: practiceQuestionSelect,
      orderBy: NEW_QUESTION_ORDER
    });
  }

  if (!question) {
    return NextResponse.json({
      question: null,
      message: buildEmptyMessage(questionType, recycleMode)
    });
  }

  await markQuestionsServed(prisma, {
    userId: user.id,
    questionIds: [question.id],
    mode: "PRACTICE"
  });

  return NextResponse.json({
    question: toPracticeQuestionDto(question),
    mode:
      recycleMode === "NONE"
        ? "new"
        : recycleMode === "ALL"
          ? "all"
          : recycleMode.toLowerCase()
  });
}
