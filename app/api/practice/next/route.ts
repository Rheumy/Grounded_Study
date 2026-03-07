import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

type PracticeQuestionDto = {
  id: string;
  stem: string;
  type: "MCQ" | "SHORT_ANSWER";
  optionsJson: string[] | null;
  difficulty: number;
  tagsJson: unknown;
};

function toPracticeQuestionDto(question: {
  id: string;
  stem: string;
  type: "MCQ" | "SHORT_ANSWER";
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

export async function GET(request: Request) {
  const user = await requireUserApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const recycle = searchParams.get("recycle") === "true";

  const now = new Date();
  const due = await prisma.spacedRepetitionSchedule.findFirst({
    where: { userId: user.id, dueAt: { lte: now } },
    include: {
      question: {
        select: {
          id: true,
          stem: true,
          type: true,
          optionsJson: true,
          difficulty: true,
          tagsJson: true
        }
      }
    }
  });

  if (due && recycle) {
    return NextResponse.json({ question: toPracticeQuestionDto(due.question), mode: "recycle" });
  }

  const completed = await prisma.practiceAttempt.findMany({
    where: { userId: user.id, correct: true },
    select: { questionId: true }
  });

  const excludeIds = recycle ? [] : completed.map((item) => item.questionId);

  const exclusion = excludeIds.length
    ? Prisma.sql`AND "id" NOT IN (${Prisma.join(excludeIds)})`
    : Prisma.empty;

  const candidate = await prisma.$queryRaw<PracticeQuestionDto[]>`
    SELECT "id", "stem", "type", "optionsJson", "difficulty", "tagsJson"
    FROM "Question"
    WHERE "ownerId" = ${user.id}
      AND "verifierStatus" = 'PASSED'
      ${exclusion}
    ORDER BY random()
    LIMIT 1
  `;

  const question = candidate[0] ?? null;
  if (!question) {
    return NextResponse.json({ question: null, message: "No questions available" });
  }

  return NextResponse.json({
    question: toPracticeQuestionDto(question),
    mode: recycle ? "recycle" : "new"
  });
}
