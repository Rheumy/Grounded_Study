import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";
import { validateUpload } from "@/lib/security/file-validation";
import { sanitizeFilename } from "@/lib/security/sanitize";
import { rateLimit } from "@/lib/security/rate-limit";
import { deleteFile, readFile, saveFile } from "@/lib/storage/storage";
import { enforceUploadLimit, incrementUsage } from "@/lib/billing/usage";
import { logger } from "@/lib/observability/logger";

async function createDocumentFromValidatedUpload(params: {
  ownerId: string;
  fileName: string;
  storageKey: string;
  sizeBytes: number;
  fileInfo: { kind: "pdf" | "image" | "text"; mime: string };
}) {
  const existing = await prisma.document.findFirst({
    where: { ownerId: params.ownerId, storageKey: params.storageKey }
  });
  if (existing) {
    return existing;
  }

  const document = await prisma.document.create({
    data: {
      id: crypto.randomUUID(),
      ownerId: params.ownerId,
      title: params.fileName,
      sourceType:
        params.fileInfo.kind === "pdf"
          ? "PDF"
          : params.fileInfo.kind === "text"
            ? "TEXT"
            : "IMAGE",
      contentType: params.fileInfo.mime,
      storageKey: params.storageKey,
      status: "QUEUED"
    }
  });

  await prisma.ingestionJob.create({
    data: {
      documentId: document.id,
      status: "QUEUED"
    }
  });

  await incrementUsage({ userId: params.ownerId, uploads: 1, storageBytes: params.sizeBytes });

  logger.info(
    {
      userId: params.ownerId,
      documentId: document.id,
      storageKey: params.storageKey,
      sourceType: document.sourceType,
      status: document.status
    },
    "Document queued for ingestion"
  );

  return document;
}

export async function POST(request: Request) {
  const user = await requireUserApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limiter = await rateLimit(`upload:${user.id}`, 10, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const requestType = request.headers.get("content-type") ?? "";

  if (requestType.includes("application/json")) {
    const body = await request.json().catch(() => null);
    const storageKey = typeof body?.storageKey === "string" ? body.storageKey : "";
    const fileName = typeof body?.fileName === "string" ? body.fileName : "";

    if (!storageKey || !fileName) {
      return NextResponse.json({ error: "Upload metadata missing" }, { status: 400 });
    }

    if (!storageKey.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const existing = await prisma.document.findFirst({
      where: { ownerId: user.id, storageKey }
    });
    if (existing) {
      return NextResponse.json({ documentId: existing.id, status: existing.status });
    }

    let buffer: Buffer;
    try {
      buffer = await readFile(storageKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to access uploaded file";
      logger.error({ userId: user.id, storageKey, message }, "Upload finalize read failed");
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const validation = await validateUpload(buffer, fileName, buffer.length);
    if (!validation.allowed || !validation.fileInfo) {
      await deleteFile(storageKey).catch(() => undefined);
      logger.error(
        { userId: user.id, storageKey, fileName, message: validation.error ?? "Invalid upload" },
        "Upload finalize validation failed"
      );
      return NextResponse.json({ error: validation.error ?? "Invalid upload" }, { status: 400 });
    }

    try {
      await enforceUploadLimit(user.id, buffer.length);
    } catch (error) {
      await deleteFile(storageKey).catch(() => undefined);
      const message = error instanceof Error ? error.message : "Upload limit reached";
      logger.error({ userId: user.id, storageKey, fileName, message }, "Upload finalize limit check failed");
      return NextResponse.json({ error: message }, { status: 400 });
    }

    try {
      const document = await createDocumentFromValidatedUpload({
        ownerId: user.id,
        fileName,
        storageKey,
        sizeBytes: buffer.length,
        fileInfo: validation.fileInfo
      });
      logger.info(
        { userId: user.id, storageKey, documentId: document.id, status: document.status },
        "Upload finalize completed"
      );
      return NextResponse.json({ documentId: document.id, status: document.status });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      logger.error({ userId: user.id, storageKey, fileName, message }, "Upload finalize persistence failed");
      return NextResponse.json({ error: message }, { status: 400 });
    }
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

  try {
    await enforceUploadLimit(user.id, buffer.length);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload limit reached";
    return NextResponse.json({ error: message }, { status: 400 });
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

  const document = await createDocumentFromValidatedUpload({
    ownerId: user.id,
    fileName: file.name,
    storageKey,
    sizeBytes: buffer.length,
    fileInfo: validation.fileInfo
  });

  return NextResponse.json({ documentId: document.id, status: document.status });
}
