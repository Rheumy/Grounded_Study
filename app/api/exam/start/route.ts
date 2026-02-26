import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";

export async function POST(request: Request) {
  const user = await requireUserApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const count = Math.min(50, Math.max(1, Number(body.count ?? 10)));
  const timeLimitMin = Math.min(180, Math.max(5, Number(body.timeLimitMin ?? 30)));
  const difficulty = body.difficulty ? Number(body.difficulty) : null;

  const difficultyClause = difficulty
    ? Prisma.sql`AND "difficulty" = ${difficulty}`
    : Prisma.empty;

  const questions = await prisma.$queryRaw<any[]>`
    SELECT * FROM "Question"
    WHERE "ownerId" = ${user.id}
      AND "verifierStatus" = 'PASSED'
      ${difficultyClause}
    ORDER BY random()
    LIMIT ${count}
  `;

  if (questions.length === 0) {
    return NextResponse.json({ error: "No questions available" }, { status: 400 });
  }

  const session = await prisma.examSession.create({
    data: {
      userId: user.id,
      modeConfigJson: {
        count,
        timeLimitMin,
        difficulty
      }
    }
  });

  await prisma.examSessionQuestion.createMany({
    data: questions.map((question, index) => ({
      sessionId: session.id,
      questionId: question.id,
      order: index + 1
    }))
  });

  const payload = questions.map((question) => ({
    id: question.id,
    stem: question.stem,
    type: question.type,
    options: question.optionsJson ?? []
  }));

  return NextResponse.json({
    sessionId: session.id,
    timeLimitMin,
    questions: payload
  });
}
