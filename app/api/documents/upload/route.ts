import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";
import { validateUpload } from "@/lib/security/file-validation";
import { sanitizeFilename } from "@/lib/security/sanitize";
import { rateLimit } from "@/lib/security/rate-limit";
import { saveFile } from "@/lib/storage/storage";

export async function POST(request: Request) {
  const user = await requireUserApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limiter = await rateLimit(`upload:${user.id}`, 10, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "File missing" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = await validateUpload(buffer, file.name, file.size);
  if (!validation.allowed || !validation.fileInfo) {
    return NextResponse.json({ error: validation.error ?? "Invalid upload" }, { status: 400 });
  }

  const docId = crypto.randomUUID();
  const safeName = sanitizeFilename(file.name);
  const storageKey = `${user.id}/${docId}/${safeName}`;

  try {
    await saveFile(buffer, storageKey, validation.fileInfo.mime);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const document = await prisma.document.create({
    data: {
      id: docId,
      ownerId: user.id,
      title: file.name,
      sourceType:
        validation.fileInfo.kind === "pdf"
          ? "PDF"
          : validation.fileInfo.kind === "text"
            ? "TEXT"
            : "IMAGE",
      contentType: validation.fileInfo.mime,
      storageKey,
      status: "QUEUED"
    }
  });

  await prisma.ingestionJob.create({
    data: {
      documentId: document.id,
      status: "QUEUED"
    }
  });

  return NextResponse.json({ documentId: document.id, status: document.status });
}
