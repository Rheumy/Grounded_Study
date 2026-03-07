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

  const session = await prisma.examSession.findUnique({
    where: { id: sessionId },
    include: {
      examSessionQuestions: {
        include: { question: true },
        orderBy: { order: "asc" }
      }
    }
  });
  if (!session || session.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const assignedQuestionIds = new Set(session.examSessionQuestions.map((item) => item.questionId));
  const invalidQuestionId = answers.find((answer) => !assignedQuestionIds.has(answer.questionId));
  if (invalidQuestionId) {
    return NextResponse.json({ error: "Answer contains a question not assigned to this exam" }, { status: 400 });
  }

  const answersByQuestionId = new Map(
    answers.map((answer) => [answer.questionId, answer.selectedAnswer] as const)
  );

  let correctCount = 0;

  for (const sessionQuestion of session.examSessionQuestions) {
    const question = sessionQuestion.question;
    const selectedAnswer = answersByQuestionId.get(question.id) ?? null;

    let correct = false;
    if (selectedAnswer && question.type === "MCQ") {
      correct = selectedAnswer === question.answer;
    } else if (selectedAnswer) {
      try {
        const grade = await gradeShortAnswer({
          question: question.stem,
          expectedAnswer: question.answer,
          studentAnswer: selectedAnswer,
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
      data: { selectedAnswer, correct }
    });
  }

  await prisma.examSession.update({
    where: { id: session.id },
    data: { endedAt: new Date() }
  });

  return NextResponse.json({
    correct: correctCount,
    total: session.examSessionQuestions.length
  });
}
