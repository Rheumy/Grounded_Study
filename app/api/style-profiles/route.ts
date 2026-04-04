import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";
import { extractStyleProfile } from "@/lib/llm/style-profile";
import { validateUpload } from "@/lib/security/file-validation";
import { ocrImage } from "@/lib/ingestion/ocr";
import { extractPdfText } from "@/lib/ingestion/pdf";
import { extractDocxText } from "@/lib/ingestion/docx";

// Maximum pages to extract per sample file uploaded to a style profile.
// Keep low — these are example files, not full study materials.
const SAMPLE_FILE_MAX_PAGES = 10;

function buildStudyContextText(formData: FormData): string | null {
  const courseName = String(formData.get("courseName") ?? "").trim();
  const institution = String(formData.get("institution") ?? "").trim();
  const countryRegion = String(formData.get("countryRegion") ?? "").trim();
  const candidateLevel = String(formData.get("candidateLevel") ?? "").trim();

  const lines = [
    courseName ? `Exam or course: ${courseName}` : null,
    institution ? `Institution or board: ${institution}` : null,
    countryRegion ? `Country or region: ${countryRegion}` : null,
    candidateLevel ? `Candidate level or training stage: ${candidateLevel}` : null
  ].filter(Boolean);

  if (lines.length === 0) return null;

  return `Study context:\n${lines.join("\n")}`;
}

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
  const studyContextText = buildStudyContextText(formData);
  const combinedInstructionsText = [instructionsText, studyContextText].filter(Boolean).join("\n\n") || null;

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
      } else if (kind === "docx") {
        const text = await extractDocxText(buffer);
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

  // Require at least one content input so the LLM has something to work with.
  if (!examplesText && !instructionsText && !sampleFilesText) {
    return NextResponse.json(
      {
        error:
          "Please provide at least one input: paste sample questions, upload a sample file, or add free-text instructions."
      },
      { status: 400 }
    );
  }

  let schemaJson;
  try {
    const profile = await extractStyleProfile({
      name,
      examplesText,
      examplesImagesText: null, // legacy field; new uploads go through sampleFilesText
      sampleFilesText,
      instructionsText: combinedInstructionsText
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
      instructionsText: combinedInstructionsText
    }
  });

  return NextResponse.json({ profile: record });
}
