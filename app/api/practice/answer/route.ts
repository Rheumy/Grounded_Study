import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";
import { updateSchedule } from "@/lib/practice/spaced-repetition";
import { gradeShortAnswer } from "@/lib/llm/grading";

export async function POST(request: Request) {
  const user = await requireUserApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const questionId = body.questionId as string | undefined;
  const selectedAnswer = (body.answer as string | undefined) ?? "";
  const timeSpentSec = Number(body.timeSpentSec ?? 0);

  if (!questionId) {
    return NextResponse.json({ error: "Missing question" }, { status: 400 });
  }

  const question = await prisma.question.findUnique({ where: { id: questionId } });
  if (!question || question.ownerId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let correct = false;
  let needsReview = false;

  if (question.type === "MCQ") {
    correct = selectedAnswer === question.answer;
  } else {
    try {
      const grade = await gradeShortAnswer({
        question: question.stem,
        expectedAnswer: question.answer,
        studentAnswer: selectedAnswer,
        citations: (question.citationsJson as any[]) ?? []
      });
      if (grade.verdict === "NEEDS_REVIEW") {
        needsReview = true;
        correct = false;
      } else {
        correct = grade.verdict === "CORRECT";
      }
    } catch (_error) {
      needsReview = true;
      correct = false;
    }
  }

  await prisma.practiceAttempt.create({
    data: {
      userId: user.id,
      questionId: question.id,
      selectedAnswer,
      correct,
      timeSpentSec
    }
  });

  await updateSchedule({ userId: user.id, questionId: question.id, correct });

  return NextResponse.json({
    correct,
    needsReview,
    rationale: question.rationale,
    citations: question.citationsJson
  });
}
