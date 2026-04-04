import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";

const QUESTION_TYPES = ["MCQ", "SHORT_ANSWER", "TRUE_FALSE"] as const;
const RECYCLE_MODES = ["NONE", "DUE", "INCORRECT"] as const;

type QuestionTypeFilter = (typeof QUESTION_TYPES)[number] | "ALL";
type RecycleMode = (typeof RECYCLE_MODES)[number];

type PracticeQuestionDto = {
  id: string;
  stem: string;
  type: "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE";
  optionsJson: string[] | null;
  difficulty: number;
  tagsJson: unknown;
};

const practiceQuestionSelect = {
  id: true,
  stem: true,
  type: true,
  optionsJson: true,
  difficulty: true,
  tagsJson: true
} satisfies Prisma.QuestionSelect;

function toPracticeQuestionDto(question: {
  id: string;
  stem: string;
  type: "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE";
  optionsJson: unknown;
  difficulty: number;
  tagsJson: unknown;
}): PracticeQuestionDto {
  return {
    id: question.id,
    stem: question.stem,
    type: question.type,
    optionsJson: Array.isArray(question.optionsJson) ? (question.optionsJson as string[]) : null,
    difficulty: question.difficulty,
    tagsJson: question.tagsJson ?? null
  };
}

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
    return `No previously incorrect ${typeLabel} questions are available right now.`;
  }

  return `No ${typeLabel} practice questions are available right now.`;
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

  const baseQuestionWhere: Prisma.QuestionWhereInput = {
    ownerId: user.id,
    verifierStatus: "PASSED",
    ...(questionType !== "ALL" ? { type: questionType } : {}),
    ...(excludeQuestionIds.length > 0 ? { id: { notIn: excludeQuestionIds } } : {})
  };

  let question:
    | {
        id: string;
        stem: string;
        type: "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE";
        optionsJson: unknown;
        difficulty: number;
        tagsJson: unknown;
      }
    | null = null;

  if (recycleMode === "DUE") {
    const due = await prisma.spacedRepetitionSchedule.findMany({
      where: {
        userId: user.id,
        dueAt: { lte: new Date() },
        question: baseQuestionWhere
      },
      select: { question: { select: practiceQuestionSelect } },
      orderBy: { dueAt: "asc" },
      take: 50
    });

    question = pickRandomQuestion(due.map((item) => item.question));
  } else if (recycleMode === "INCORRECT") {
    const candidates = await prisma.question.findMany({
      where: {
        ...baseQuestionWhere,
        practiceAttempts: {
          some: {
            userId: user.id,
            correct: false
          }
        }
      },
      select: practiceQuestionSelect,
      take: 200
    });

    question = pickRandomQuestion(candidates);
  } else {
    const candidates = await prisma.question.findMany({
      where: {
        ...baseQuestionWhere,
        practiceAttempts: {
          none: {
            userId: user.id,
            correct: true
          }
        }
      },
      select: practiceQuestionSelect,
      take: 200
    });

    question = pickRandomQuestion(candidates);
  }

  if (!question) {
    return NextResponse.json({
      question: null,
      message: buildEmptyMessage(questionType, recycleMode)
    });
  }

  return NextResponse.json({
    question: toPracticeQuestionDto(question),
    mode: recycleMode === "NONE" ? "new" : recycleMode.toLowerCase()
  });
}
