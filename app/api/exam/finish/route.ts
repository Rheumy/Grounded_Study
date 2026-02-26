import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";
import { gradeShortAnswer } from "@/lib/llm/grading";

export async function POST(request: Request) {
  const user = await requireUserApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const sessionId = body.sessionId as string | undefined;
  const answers = (body.answers as { questionId: string; selectedAnswer: string }[]) ?? [];

  if (!sessionId) {
    return NextResponse.json({ error: "Missing session" }, { status: 400 });
  }

  const session = await prisma.examSession.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let correctCount = 0;

  for (const answer of answers) {
    const question = await prisma.question.findUnique({ where: { id: answer.questionId } });
    if (!question) continue;

    let correct = false;
    if (question.type === "MCQ") {
      correct = answer.selectedAnswer === question.answer;
    } else {
      try {
        const grade = await gradeShortAnswer({
          question: question.stem,
          expectedAnswer: question.answer,
          studentAnswer: answer.selectedAnswer,
          citations: (question.citationsJson as any[]) ?? []
        });
        correct = grade.verdict === "CORRECT";
      } catch (_error) {
        correct = false;
      }
    }

    if (correct) correctCount += 1;

    await prisma.examSessionQuestion.updateMany({
      where: { sessionId: session.id, questionId: question.id },
      data: { selectedAnswer: answer.selectedAnswer, correct }
    });
  }

  await prisma.examSession.update({
    where: { id: session.id },
    data: { endedAt: new Date() }
  });

  return NextResponse.json({
    correct: correctCount,
    total: answers.length
  });
}
