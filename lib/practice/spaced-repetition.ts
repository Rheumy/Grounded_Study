import { prisma } from "@/lib/db/prisma";

export async function updateSchedule(params: {
  userId: string;
  questionId: string;
  correct: boolean;
}) {
  const existing = await prisma.spacedRepetitionSchedule.findUnique({
    where: { userId_questionId: { userId: params.userId, questionId: params.questionId } }
  });

  const now = new Date();
  let intervalDays = existing?.intervalDays ?? 1;
  let easeFactor = existing?.easeFactor ?? 2.3;

  if (params.correct) {
    intervalDays = Math.max(1, Math.round(intervalDays * easeFactor));
    easeFactor = Math.min(2.8, easeFactor + 0.1);
  } else {
    intervalDays = 1;
    easeFactor = Math.max(1.3, easeFactor - 0.2);
  }

  const dueAt = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);

  await prisma.spacedRepetitionSchedule.upsert({
    where: { userId_questionId: { userId: params.userId, questionId: params.questionId } },
    update: { dueAt, intervalDays, easeFactor },
    create: { userId: params.userId, questionId: params.questionId, dueAt, intervalDays, easeFactor }
  });
}
