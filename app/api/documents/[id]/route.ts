import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";
import { deleteFile } from "@/lib/storage/storage";

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const user = await requireUserApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const document = await prisma.document.findUnique({ where: { id: params.id } });
  if (!document || document.ownerId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.document.delete({ where: { id: document.id } });
  await deleteFile(document.storageKey);

  return NextResponse.json({ ok: true });
}
