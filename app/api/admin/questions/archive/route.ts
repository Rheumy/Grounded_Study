import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { z } from "zod";
import { authOptions } from "@/lib/auth/options";
import { prisma } from "@/lib/db/prisma";

const ArchiveQuestionSchema = z.object({
  questionId: z.string().trim().min(1),
  reason: z.string().trim().max(300).optional()
});

function toValidationErrorMessage(error: z.ZodError): string {
  const issue = error.issues[0];

  if (!issue) {
    return "Unable to archive that question right now.";
  }

  if (issue.path[0] === "questionId") {
    return "Choose a question to archive.";
  }

  if (issue.path[0] === "reason") {
    return "Keep the archive note under 300 characters.";
  }

  return "Unable to archive that question right now.";
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const user = session?.user as { id?: string; isAdmin?: boolean } | undefined;

  if (!user?.id || !user.isAdmin) {
    return NextResponse.json({ error: "Admin access is required." }, { status: 403 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = ArchiveQuestionSchema.safeParse(rawBody);

  if (!parsed.success) {
    return NextResponse.json({ error: toValidationErrorMessage(parsed.error) }, { status: 400 });
  }

  const reason = parsed.data.reason?.trim() ? parsed.data.reason.trim() : null;

  const question = await prisma.question.findUnique({
    where: { id: parsed.data.questionId },
    select: {
      id: true,
      verifierStatus: true
    }
  });

  if (!question) {
    return NextResponse.json({ error: "Question not found." }, { status: 404 });
  }

  if (question.verifierStatus !== "PASSED") {
    return NextResponse.json(
      { error: "This question is already out of the active question bank." },
      { status: 400 }
    );
  }

  try {
    await prisma.$transaction([
      prisma.question.update({
        where: { id: question.id },
        data: { verifierStatus: "FAILED" }
      }),
      prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: "QUESTION_ARCHIVED",
          targetType: "Question",
          targetId: question.id,
          metadataJson: {
            previousVerifierStatus: question.verifierStatus,
            reason
          }
        }
      })
    ]);

    return NextResponse.json({
      success: true,
      message: "Question archived. It will no longer appear in active practice or mock exams."
    });
  } catch (_error) {
    return NextResponse.json(
      { error: "Unable to archive that question right now. Please try again." },
      { status: 500 }
    );
  }
}
