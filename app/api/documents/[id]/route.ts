import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { deleteDocument } from "@/lib/documents/delete";

async function readDeleteOptions(request: Request) {
  const body = await request.json().catch(() => null);
  return {
    deleteAssociatedQuestions: body?.deleteAssociatedQuestions === true
  };
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const user = await requireUserApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const options = await readDeleteOptions(request);
    const result = await deleteDocument(params.id, user.id, options);
    return NextResponse.json({ ok: true, archivedQuestionCount: result.archivedQuestionCount });
  } catch (error) {
    if (error instanceof Error && error.message === "Document not found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
