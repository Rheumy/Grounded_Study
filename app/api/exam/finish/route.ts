import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";
import { gradeShortAnswer } from "@/lib/llm/grading";
import {
  buildUserFacingRationale,
  formatFeedbackCitations,
  getShortAnswerReviewStatus,
  normalizeCitationRecords,
  sanitizeFeedbackText
} from "@/lib/feedback/user-facing";

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
  let needsReviewCount = 0;
  let objectiveTotal = 0;
  let objectiveCorrect = 0;
  let shortAnswerReviewed = 0;
  let shortAnswerStrongMatch = 0;
  let shortAnswerPartialMatch = 0;
  const review = [];

  for (const sessionQuestion of session.examSessionQuestions) {
    const question = sessionQuestion.question;
    const selectedAnswer = answersByQuestionId.get(question.id) ?? null;
    const hasAnswer = Boolean(selectedAnswer?.trim());
    const citations = normalizeCitationRecords(question.citationsJson);

    let correct = false;
    let needsReview = false;
    let graderReason: string | null = null;

    if (selectedAnswer && (question.type === "MCQ" || question.type === "TRUE_FALSE")) {
      correct = selectedAnswer === question.answer;
    } else if (selectedAnswer) {
      try {
        const grade = await gradeShortAnswer({
          question: question.stem,
          expectedAnswer: question.answer,
          studentAnswer: selectedAnswer,
          citations,
          userId: user.id,
          questionId: question.id,
          metadata: {
            flow: "exam_finish",
            sessionId: session.id
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
        correct = false;
        needsReview = question.type === "SHORT_ANSWER";
        graderReason = "The answer could not be graded confidently from the available evidence.";
      }
    }

    const reviewStatus = getShortAnswerReviewStatus({
      questionType: question.type,
      hasAnswer,
      correct,
      needsReview
    });

    if (question.type === "MCQ" || question.type === "TRUE_FALSE") {
      objectiveTotal += 1;
      if (correct) objectiveCorrect += 1;
    } else if (reviewStatus) {
      shortAnswerReviewed += 1;
      if (reviewStatus === "STRONG_MATCH") shortAnswerStrongMatch += 1;
      if (reviewStatus === "PARTIAL_MATCH") shortAnswerPartialMatch += 1;
    }

    if (correct) correctCount += 1;
    if (needsReview) needsReviewCount += 1;

    await prisma.examSessionQuestion.updateMany({
      where: { sessionId: session.id, questionId: question.id },
      data: { selectedAnswer, correct }
    });

    review.push({
      order: sessionQuestion.order,
      questionId: question.id,
      stem: sanitizeFeedbackText(question.stem),
      type: question.type,
      userAnswer: selectedAnswer,
      correct,
      needsReview,
      reviewStatus,
      correctAnswer: sanitizeFeedbackText(question.answer),
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

  await prisma.examSession.update({
    where: { id: session.id },
    data: { endedAt: new Date() }
  });

  return NextResponse.json({
    correct: correctCount,
    total: session.examSessionQuestions.length,
    needsReview: needsReviewCount,
    objectiveCorrect,
    objectiveTotal,
    shortAnswerReviewed,
    shortAnswerStrongMatch,
    shortAnswerPartialMatch,
    shortAnswerNeedsReview: needsReviewCount,
    review
  });
}
