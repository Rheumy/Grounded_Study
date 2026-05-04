import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const user = await requireUserApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const documents = await prisma.document.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      ingestionJobs: {
        orderBy: { updatedAt: "desc" },
        take: 1
      }
    }
  });

  return NextResponse.json({
    documents: documents.map((document) => ({
      id: document.id,
      title: document.title,
      status: document.status,
      createdAt: document.createdAt.toISOString(),
      latestError: document.ingestionJobs[0]?.lastError ?? null
    }))
  });
}
