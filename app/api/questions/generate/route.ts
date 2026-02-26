import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";
import { generateQuestions } from "@/lib/llm/generate";
import { enforceQuestionLimit, incrementUsage } from "@/lib/billing/usage";

export async function POST(request: Request) {
  const user = await requireUserApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const documentIds: string[] = body.documentIds ?? [];
  const styleProfileId: string | null = body.styleProfileId ?? null;
  const difficulty = Math.min(5, Math.max(1, Number(body.difficulty ?? 3)));
  const count = Math.min(20, Math.max(1, Number(body.count ?? 5)));

  const documents = await prisma.document.findMany({
    where: { id: { in: documentIds }, ownerId: user.id, status: "READY" }
  });

  if (documents.length === 0) {
    return NextResponse.json({ error: "No ready documents selected" }, { status: 400 });
  }

  try {
    await enforceQuestionLimit(user.id, count);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Question limit reached";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const results = await generateQuestions({
      ownerId: user.id,
      documentIds: documents.map((doc) => doc.id),
      styleProfileId,
      difficulty,
      count
    });
    const passed = results.filter((result) => result.status === "PASSED").length;
    await incrementUsage({ userId: user.id, questions: passed });
    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
