import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";

const QUESTION_STYLE_PROMPT_THRESHOLD = 3;
const LEGACY_HIDING_FEEDBACK_LABELS = ["DISPUTED_INCORRECT", "IRRELEVANT"] as const;
const BETA_FEEDBACK_LABELS = [
  "GOOD_EXAM_STYLE",
  "TOO_EASY_LOW_VALUE",
  "POOR_WORDING",
  "NOT_EXAM_RELEVANT",
  "INCORRECT_OR_UNSUPPORTED",
  "DOCUMENT_TRIVIA",
  "OTHER"
] as const;
const ALL_FEEDBACK_LABELS = [
  "EASY",
  "HARD",
  "GOOD_QUESTION",
  "DISPUTED_INCORRECT",
  "IRRELEVANT",
  ...BETA_FEEDBACK_LABELS
] as const;
const BETA_ISSUE_FEEDBACK_LABELS = BETA_FEEDBACK_LABELS.filter(
  (label) => label !== "GOOD_EXAM_STYLE"
);

const PracticeFeedbackSchema = z.object({
  questionId: z.string().trim().min(1),
  attemptId: z.string().trim().min(1).optional(),
  label: z.enum(ALL_FEEDBACK_LABELS),
  comment: z.string().trim().max(500).optional()
}).superRefine((value, ctx) => {
  if (value.label !== "OTHER") {
    return;
  }

  if (!value.comment?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["comment"],
      message: "Other feedback needs a comment."
    });
  }
});

function isHidingFeedbackLabel(label: z.infer<typeof PracticeFeedbackSchema>["label"]): boolean {
  return LEGACY_HIDING_FEEDBACK_LABELS.includes(
    label as (typeof LEGACY_HIDING_FEEDBACK_LABELS)[number]
  );
}

function isBetaIssueFeedbackLabel(label: z.infer<typeof PracticeFeedbackSchema>["label"]): boolean {
  return BETA_ISSUE_FEEDBACK_LABELS.includes(label as (typeof BETA_ISSUE_FEEDBACK_LABELS)[number]);
}

function toValidationErrorMessage(error: z.ZodError): string {
  const issue = error.issues[0];

  if (!issue) {
    return "Unable to save your feedback right now.";
  }

  if (issue.path[0] === "questionId") {
    return "Missing question.";
  }

  if (issue.path[0] === "attemptId") {
    return "That practice attempt could not be found.";
  }

  if (issue.path[0] === "comment") {
    if (issue.code === "custom") {
      return "Add a short comment for Other feedback.";
    }

    return "Keep your note under 500 characters.";
  }

  return "Choose one of the question feedback options.";
}

export async function POST(request: Request) {
  const user = await requireUserApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = PracticeFeedbackSchema.safeParse(rawBody);

  if (!parsed.success) {
    return NextResponse.json({ error: toValidationErrorMessage(parsed.error) }, { status: 400 });
  }

  const comment = parsed.data.comment?.trim() ? parsed.data.comment.trim() : null;
  const existingFeedback = await prisma.questionFeedback.findUnique({
    where: {
      userId_questionId: {
        userId: user.id,
        questionId: parsed.data.questionId
      }
    },
    select: {
      label: true
    }
  });

  const question = await prisma.question.findUnique({
    where: { id: parsed.data.questionId },
    select: { id: true, ownerId: true }
  });

  if (!question || question.ownerId !== user.id) {
    return NextResponse.json({ error: "Question not found." }, { status: 404 });
  }

  if (parsed.data.attemptId) {
    const attempt = await prisma.practiceAttempt.findFirst({
      where: {
        id: parsed.data.attemptId,
        userId: user.id,
        questionId: question.id
      },
      select: { id: true }
    });

    if (!attempt) {
      return NextResponse.json({ error: "That practice attempt could not be found." }, { status: 404 });
    }
  }

  try {
    const [feedback, flaggedFeedbackCount] = await prisma.$transaction([
      prisma.questionFeedback.upsert({
        where: {
          userId_questionId: {
            userId: user.id,
            questionId: question.id
          }
        },
        update: {
          label: parsed.data.label,
          comment,
          ...(parsed.data.attemptId ? { attemptId: parsed.data.attemptId } : {})
        },
        create: {
          userId: user.id,
          questionId: question.id,
          attemptId: parsed.data.attemptId,
          label: parsed.data.label,
          comment
        },
        select: {
          label: true,
          comment: true,
          updatedAt: true
        }
      }),
      prisma.questionFeedback.count({
        where: {
          userId: user.id,
          label: {
            in: [...BETA_ISSUE_FEEDBACK_LABELS, ...LEGACY_HIDING_FEEDBACK_LABELS]
          }
        }
      })
    ]);
    const hidesQuestionFromFuture = isHidingFeedbackLabel(parsed.data.label);
    const shouldShowQuestionStylePrompt =
      isBetaIssueFeedbackLabel(parsed.data.label) &&
      flaggedFeedbackCount >= QUESTION_STYLE_PROMPT_THRESHOLD &&
      !isHidingFeedbackLabel(existingFeedback?.label ?? "EASY");

    return NextResponse.json({
      feedback,
      hidesQuestionFromFuture,
      shouldShowQuestionStylePrompt,
      message: hidesQuestionFromFuture
        ? "Thanks — we’ll stop showing this question to you."
        : undefined
    });
  } catch (_error) {
    return NextResponse.json(
      { error: "Unable to save your feedback right now. Please try again." },
      { status: 500 }
    );
  }
}
