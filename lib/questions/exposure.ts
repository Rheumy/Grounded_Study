import { Prisma, QuestionExposureMode } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

type QuestionExposureDbClient = Prisma.TransactionClient | typeof prisma;

export const HIDDEN_QUESTION_FEEDBACK_LABELS = ["DISPUTED_INCORRECT", "IRRELEVANT"] as const;

export function buildFeedbackExcludedQuestionFilter(userId: string): Prisma.QuestionWhereInput {
  return {
    questionFeedbacks: {
      none: {
        userId,
        label: {
          in: [...HIDDEN_QUESTION_FEEDBACK_LABELS]
        }
      }
    }
  };
}

export function buildHiddenQuestionFilter(userId: string): Prisma.QuestionWhereInput {
  return {
    questionExposures: {
      none: {
        userId,
        hiddenAt: {
          not: null
        }
      }
    }
  };
}

export function buildUnseenQuestionFilter(userId: string): Prisma.QuestionWhereInput {
  return {
    questionExposures: {
      none: {
        userId
      }
    }
  };
}

export async function markQuestionsServed(
  db: QuestionExposureDbClient,
  params: {
    userId: string;
    questionIds: string[];
    mode: QuestionExposureMode;
  }
) {
  const questionIds = Array.from(new Set(params.questionIds.filter(Boolean)));

  if (questionIds.length === 0) {
    return;
  }

  const servedAt = new Date();

  await Promise.all(
    questionIds.map((questionId) =>
      db.questionExposure.upsert({
        where: {
          userId_questionId: {
            userId: params.userId,
            questionId
          }
        },
        update: {
          lastServedAt: servedAt,
          timesServed: {
            increment: 1
          },
          lastServedMode: params.mode
        },
        create: {
          userId: params.userId,
          questionId,
          firstServedAt: servedAt,
          lastServedAt: servedAt,
          timesServed: 1,
          lastServedMode: params.mode
        }
      })
    )
  );
}

export async function hideQuestionForUser(
  db: QuestionExposureDbClient,
  params: {
    userId: string;
    questionId: string;
  }
) {
  const now = new Date();

  return db.questionExposure.upsert({
    where: {
      userId_questionId: {
        userId: params.userId,
        questionId: params.questionId
      }
    },
    update: {
      hiddenAt: now
    },
    create: {
      userId: params.userId,
      questionId: params.questionId,
      firstServedAt: now,
      lastServedAt: now,
      timesServed: 1,
      lastServedMode: QuestionExposureMode.PRACTICE,
      hiddenAt: now
    }
  });
}
