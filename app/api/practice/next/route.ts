import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

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
    include: { question: true }
  });

  if (due && recycle) {
    return NextResponse.json({ question: due.question, mode: "recycle" });
  }

  const completed = await prisma.practiceAttempt.findMany({
    where: { userId: user.id, correct: true },
    select: { questionId: true }
  });

  const excludeIds = recycle ? [] : completed.map((item) => item.questionId);

  const exclusion = excludeIds.length
    ? Prisma.sql`AND "id" NOT IN (${Prisma.join(excludeIds)})`
    : Prisma.empty;

  const candidate = await prisma.$queryRaw<any[]>`
    SELECT * FROM "Question"
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

  return NextResponse.json({ question, mode: recycle ? "recycle" : "new" });
}
