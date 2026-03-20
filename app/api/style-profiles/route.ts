import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";
import { extractStyleProfile } from "@/lib/llm/style-profile";
import { validateUpload } from "@/lib/security/file-validation";
import { ocrImage } from "@/lib/ingestion/ocr";
import { extractPdfText } from "@/lib/ingestion/pdf";

// Maximum pages to extract per sample file uploaded to a style profile.
// Keep low — these are example files, not full study materials.
const SAMPLE_FILE_MAX_PAGES = 10;

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
  const name = String(formData.get("name") ?? "Untitled format");
  const examplesText = formData.get("examplesText")?.toString() || null;
  const instructionsText = formData.get("instructionsText")?.toString() || null;

  // Collect all uploaded sample files (PDF or image, possibly multiple)
  const sampleFileEntries = formData.getAll("sampleFile");
  const extractedTexts: string[] = [];

  for (const entry of sampleFileEntries) {
    if (!(entry instanceof File) || entry.size === 0) continue;

    const buffer = Buffer.from(await entry.arrayBuffer());
    const validation = await validateUpload(buffer, entry.name, entry.size);

    if (!validation.allowed || !validation.fileInfo) {
      return NextResponse.json(
        { error: `Invalid file "${entry.name}": ${validation.error ?? "unsupported type"}` },
        { status: 400 }
      );
    }

    const { kind, mime } = validation.fileInfo;

    try {
      if (kind === "pdf") {
        const pages = await extractPdfText(buffer, SAMPLE_FILE_MAX_PAGES);
        const text = pages.map((p) => p.text).join("\n\n").trim();
        if (text) extractedTexts.push(text);
      } else if (kind === "image") {
        const text = await ocrImage(buffer, mime);
        if (text) extractedTexts.push(text);
      }
      // text files: not expected for style profile samples but validateUpload allows them
    } catch (error) {
      const message = error instanceof Error ? error.message : "File processing failed";
      return NextResponse.json(
        { error: `Could not process file "${entry.name}": ${message}` },
        { status: 400 }
      );
    }
  }

  const sampleFilesText = extractedTexts.length > 0 ? extractedTexts.join("\n\n---\n\n") : null;

  let schemaJson;
  try {
    const profile = await extractStyleProfile({
      name,
      examplesText,
      examplesImagesText: null, // legacy field; new uploads go through sampleFilesText
      sampleFilesText,
      instructionsText
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
      examplesImagesText: null,
      sampleFilesText,
      instructionsText
    }
  });

  return NextResponse.json({ profile: record });
}
