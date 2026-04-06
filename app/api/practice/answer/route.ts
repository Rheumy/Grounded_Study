import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";
import { updateSchedule } from "@/lib/practice/spaced-repetition";
import { gradeShortAnswer } from "@/lib/llm/grading";
import {
  buildUserFacingRationale,
  formatFeedbackCitations,
  getShortAnswerReviewStatus,
  normalizeCitationRecords
} from "@/lib/feedback/user-facing";

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
  let graderReason: string | null = null;
  const hasAnswer = selectedAnswer.trim().length > 0;
  const citations = normalizeCitationRecords(question.citationsJson);

  if (question.type === "MCQ" || question.type === "TRUE_FALSE") {
    correct = selectedAnswer === question.answer;
  } else {
    try {
      const grade = await gradeShortAnswer({
        question: question.stem,
        expectedAnswer: question.answer,
        studentAnswer: selectedAnswer,
        citations,
        userId: user.id,
        questionId: question.id,
        metadata: {
          flow: "practice_answer"
        }
      });
      graderReason = grade.reason;
      if (grade.verdict === "NEEDS_REVIEW") {
        needsReview = true;
        correct = false;
      } else {
        correct = grade.verdict === "CORRECT";
      }
    } catch (_error) {
      needsReview = true;
      correct = false;
      graderReason = "The answer could not be graded confidently from the available evidence.";
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

  const reviewStatus = getShortAnswerReviewStatus({
    questionType: question.type,
    hasAnswer,
    correct,
    needsReview
  });

  return NextResponse.json({
    correct,
    needsReview,
    reviewStatus,
    correctAnswer: question.answer,
    rationale: buildUserFacingRationale({
      questionType: question.type,
      storedRationale: question.rationale,
      graderReason,
      correct,
      needsReview
    }),
    citations: formatFeedbackCitations(question.citationsJson)
  });
}
