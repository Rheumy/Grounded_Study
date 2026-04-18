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

function cleanStyleProfileName(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[\s\-:;,.]+/, "")
    .replace(/[\s\-:;,.]+$/, "")
    .trim()
    .slice(0, 60);
}

function deriveStyleProfileName(params: {
  courseName: string;
  guidanceText: string | null;
}): string {
  const fromCourse = cleanStyleProfileName(params.courseName);
  if (fromCourse) {
    return fromCourse;
  }

  const guidance = params.guidanceText ?? "";
  const firstMeaningfulLine =
    guidance
      .split(/\n+/)
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  const firstSentence = firstMeaningfulLine.split(/(?<=[.!?])\s+/)[0] ?? firstMeaningfulLine;
  const simplified = firstSentence
    .replace(/^(please|can you|i want|i would like|i'd like|give me|make|create)\s+/i, "")
    .replace(/^(questions?\s+(should|that)\s+be)\s+/i, "")
    .replace(/^(for|about)\s+/i, "");
  const fromGuidance = cleanStyleProfileName(simplified);

  return fromGuidance || "My question style";
}

function buildStudyContextText(formData: FormData): string | null {
  const courseName = String(formData.get("courseName") ?? "").trim();

  if (!courseName) return null;

  return `Study context:\nExam or course: ${courseName}`;
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
  const courseName = String(formData.get("courseName") ?? "").trim();
  const legacyExamplesText = formData.get("examplesText")?.toString().trim() || "";
  const legacyInstructionsText = formData.get("instructionsText")?.toString().trim() || "";
  const guidanceText =
    formData.get("guidanceText")?.toString().trim() ||
    [legacyInstructionsText, legacyExamplesText].filter(Boolean).join("\n\n") ||
    null;
  const name = deriveStyleProfileName({ courseName, guidanceText });
  const studyContextText = buildStudyContextText(formData);
  const combinedInstructionsText = studyContextText;

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
        const text = await ocrImage(buffer, mime, {
          userId: user.id,
          metadata: {
            source: "style_profile_sample",
            fileName: entry.name
          }
        });
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
  if (!guidanceText && !sampleFilesText) {
    return NextResponse.json(
      {
        error:
          "Please add guidance, paste examples, or upload a sample file so we can build your question style."
      },
      { status: 400 }
    );
  }

  let schemaJson;
  try {
    const profile = await extractStyleProfile({
      name,
      examplesText: guidanceText,
      examplesImagesText: null, // legacy field; new uploads go through sampleFilesText
      sampleFilesText,
      instructionsText: combinedInstructionsText,
      userId: user.id
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
      examplesText: guidanceText,
      examplesImagesText: null,
      sampleFilesText,
      instructionsText: combinedInstructionsText
    }
  });

  return NextResponse.json({ profile: record });
}
