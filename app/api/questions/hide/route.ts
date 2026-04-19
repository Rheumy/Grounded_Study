import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";
import { hideQuestionForUser } from "@/lib/questions/exposure";

const HideQuestionSchema = z.object({
  questionId: z.string().trim().min(1)
});

export async function POST(request: Request) {
  const user = await requireUserApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = HideQuestionSchema.safeParse(rawBody);

  if (!parsed.success) {
    return NextResponse.json({ error: "Missing question." }, { status: 400 });
  }

  const question = await prisma.question.findUnique({
    where: { id: parsed.data.questionId },
    select: {
      id: true,
      ownerId: true
    }
  });

  if (!question || question.ownerId !== user.id) {
    return NextResponse.json({ error: "Question not found." }, { status: 404 });
  }

  try {
    await hideQuestionForUser(prisma, {
      userId: user.id,
      questionId: question.id
    });

    return NextResponse.json({
      message: "We’ll hide this question from your future practice and mock exams."
    });
  } catch (_error) {
    return NextResponse.json(
      { error: "Unable to hide this question right now. Please try again." },
      { status: 500 }
    );
  }
}
