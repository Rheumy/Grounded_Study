import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";
import { markJobCompleted, markJobFailed } from "@/lib/jobs/queue";
import { processIngestionJob } from "@/lib/jobs/processor";

function toUserFacingIngestionError(message: string, documentStatus: string): string {
  if (documentStatus === "OCR_DISABLED") {
    return "Text extraction for image uploads is not available in this deployment.";
  }

  if (message.toLowerCase().includes("openai api key")) {
    return "A required OCR or AI service is not configured for this upload.";
  }

  return message || "Document processing failed.";
}

export async function POST(request: Request) {
  const user = await requireUserApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const documentId = typeof body.documentId === "string" ? body.documentId : "";

  if (!documentId) {
    return NextResponse.json({ error: "Missing document" }, { status: 400 });
  }

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      ingestionJobs: {
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  if (!document || document.ownerId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (document.status === "READY") {
    return NextResponse.json({ ok: true, status: "READY" });
  }

  const job = document.ingestionJobs[0];
  if (!job) {
    return NextResponse.json({ error: "No ingestion job found for this document." }, { status: 400 });
  }

  if (document.status === "PROCESSING" || job.status === "RUNNING") {
    return NextResponse.json({ ok: true, status: "PROCESSING" });
  }

  const claimed = await prisma.ingestionJob.updateMany({
    where: {
      id: job.id,
      status: { in: ["QUEUED", "FAILED"] }
    },
    data: {
      status: "RUNNING",
      lockedAt: new Date(),
      attempts: { increment: 1 },
      lastError: null
    }
  });

  if (claimed.count === 0) {
    const refreshed = await prisma.document.findUnique({ where: { id: document.id } });
    return NextResponse.json({ ok: true, status: refreshed?.status ?? document.status });
  }

  try {
    await processIngestionJob(job.id);
    await markJobCompleted(job.id);
    return NextResponse.json({ ok: true, status: "READY" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document processing failed";
    await markJobFailed(job.id, message);

    const refreshed = await prisma.document.findUnique({ where: { id: document.id } });
    const status = refreshed?.status ?? "FAILED";
    return NextResponse.json(
      {
        ok: false,
        status,
        error: toUserFacingIngestionError(message, status)
      },
      { status: 500 }
    );
  }
}
