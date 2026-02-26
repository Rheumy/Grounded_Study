import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";
import { extractStyleProfile } from "@/lib/llm/style-profile";
import { validateUpload } from "@/lib/security/file-validation";
import { ocrImage } from "@/lib/ingestion/ocr";

export async function GET() {
  const user = await requireUserApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profiles = await prisma.styleProfile.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: "desc" }
  });

  return NextResponse.json({ profiles });
}

export async function POST(request: Request) {
  const user = await requireUserApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const name = String(formData.get("name") ?? "Untitled style");
  const examplesText = formData.get("examplesText")?.toString() ?? null;
  const image = formData.get("image");

  let examplesImagesText: string | null = null;
  if (image && image instanceof File) {
    const buffer = Buffer.from(await image.arrayBuffer());
    const validation = await validateUpload(buffer, image.name, image.size);
    if (!validation.allowed || validation.fileInfo?.kind !== "image") {
      return NextResponse.json({ error: "Invalid image for OCR" }, { status: 400 });
    }
    try {
      examplesImagesText = await ocrImage(buffer, validation.fileInfo.mime);
    } catch (error) {
      const message = error instanceof Error ? error.message : "OCR failed";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  let schemaJson;
  try {
    const profile = await extractStyleProfile({
      name,
      examplesText,
      examplesImagesText
    });
    schemaJson = profile;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Style extraction failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const record = await prisma.styleProfile.create({
    data: {
      ownerId: user.id,
      name,
      schemaJson,
      examplesText,
      examplesImagesText
    }
  });

  return NextResponse.json({ profile: record });
}
