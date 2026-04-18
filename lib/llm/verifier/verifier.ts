import fs from "fs/promises";
import path from "path";
import { getOpenAIClient } from "@/lib/llm/openai";
import { logger } from "@/lib/observability/logger";
import type { GeneratedQuestion } from "@/lib/llm/schemas/question";
import { recordOpenAiUsageEvent } from "@/lib/observability/ai-usage";

const MODEL = "gpt-4o-mini";

export type VerifierResult = {
  status: "PASSED" | "FAILED";
  reason: string;
  failureCodes?: string[];
  confidence?: "HIGH" | "MEDIUM" | "LOW";
};

function normalizeFailureCodes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  return Array.from(
    new Set(
      raw
        .filter((code): code is string => typeof code === "string")
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

function ensureFailureCode(failureCodes: string[], code: string): string[] {
  return failureCodes.includes(code) ? failureCodes : [...failureCodes, code];
}

function countMatches(value: string, pattern: RegExp): number {
  const matches = value.match(pattern);
  return matches ? matches.length : 0;
}

function looksLikeMetadataQuestion(question: GeneratedQuestion): boolean {
  const normalized = [question.stem, question.answer, question.rationale]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return false;
  }

  if (
    /\btable of contents\b/.test(normalized) ||
    /\bcontents page\b/.test(normalized) ||
    /\bbibliograph(y|ic)\b/.test(normalized) ||
    /\breference list\b/.test(normalized) ||
    /\bworks cited\b/.test(normalized) ||
    /\bwho (?:is|are) the authors?\b/.test(normalized) ||
    /\bauthors?\b.{0,40}\b(?:qualifications?|affiliations?|biograph(?:y|ical)|credentials?|names?)\b/.test(normalized) ||
    /\baffiliations?\b/.test(normalized) ||
    /\bqualifications?\b/.test(normalized) ||
    /\bcopyright\b/.test(normalized) ||
    /\bpublisher\b/.test(normalized) ||
    /\bdoi\b/.test(normalized) ||
    /\bpage numbers?\b/.test(normalized) ||
    /\bheading(?:s)?\b/.test(normalized) ||
    /\bchapter titles?\b/.test(normalized) ||
    /\bsection headings?\b/.test(normalized) ||
    /\bthe passage says\b/.test(normalized) ||
    /\bthe excerpt mentions\b/.test(normalized)
  ) {
    return true;
  }

  return (
    countMatches(normalized, /\b(?:chapter|section|appendix|heading)\b/g) >= 2 &&
    countMatches(normalized, /\b(?:page|contents|reference|bibliography)\b/g) >= 1
  );
}

function reasonSuggestsMetadataFailure(reason: string, failureCodes: string[]): boolean {
  const normalized = reason.trim().toLowerCase();

  if (
    failureCodes.includes("LOW_EDUCATIONAL_VALUE") &&
    /metadata|document structure|table of contents|author (?:name|qualification|affiliation|biography)|bibliograph|reference|copyright|publisher/.test(
      normalized
    )
  ) {
    return true;
  }

  return /metadata|document structure|table of contents|author (?:name|qualification|affiliation|biography)|bibliograph|reference list|copyright|publisher|document formatting/.test(
    normalized
  );
}

// ---------------------------------------------------------------------------
// Normalise the model's raw verifier response.
// The prompt asks for PASSED/FAILED but the model sometimes returns PASS/FAIL,
// SUFFICIENT_EVIDENCE, YES/NO, or echoes back fields from the question JSON.
// Conservative default: anything not clearly positive → FAILED.
// ---------------------------------------------------------------------------
function normalizeVerifierResponse(raw: unknown): VerifierResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { status: "FAILED", reason: "Verifier returned unexpected response shape" };
  }

  const obj = raw as Record<string, unknown>;

  const reason =
    String(obj.reason ?? obj.explanation ?? obj.message ?? obj.details ?? "").trim() ||
    "No reason provided";

  const rawStatus = String(obj.status ?? obj.verdict ?? obj.result ?? "")
    .trim()
    .toUpperCase();

  const isPass =
    rawStatus === "PASSED" ||
    rawStatus === "PASS" ||
    rawStatus === "SUFFICIENT_EVIDENCE" ||
    rawStatus === "YES" ||
    rawStatus === "TRUE" ||
    rawStatus === "VALID" ||
    rawStatus === "OK";

  const failureCodes = normalizeFailureCodes(obj.failureCodes);
  const rawConfidence = String(obj.confidence ?? "")
    .trim()
    .toUpperCase();
  const confidence =
    rawConfidence === "HIGH" || rawConfidence === "MEDIUM" || rawConfidence === "LOW"
      ? rawConfidence
      : undefined;

  return {
    status: isPass ? "PASSED" : "FAILED",
    reason,
    failureCodes,
    confidence
  };
}

export async function verifyQuestion(params: {
  question: GeneratedQuestion;
  chunks: { id: string; content: string; page: number | null }[];
  userId?: string | null;
  questionId?: string | null;
  documentId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<VerifierResult> {
  const promptPath = path.join(process.cwd(), "lib", "llm", "prompts", "question-verifier.md");
  const system = await fs.readFile(promptPath, "utf8");

  const chunkMap = params.chunks
    .map((chunk) => `Chunk ${chunk.id} (page ${chunk.page ?? "n/a"}): ${chunk.content}`)
    .join("\n\n");

  const user = `Question JSON:\n${JSON.stringify(params.question)}\n\nExcerpts:\n${chunkMap}`;

  const client = getOpenAIClient();
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    response_format: { type: "json_object" }
  });

  await recordOpenAiUsageEvent({
    feature: "question_verification",
    response,
    mode: "chat",
    userId: params.userId ?? null,
    questionId: params.questionId ?? null,
    documentId: params.documentId ?? null,
    metadata: {
      questionType: params.question.type,
      difficulty: params.question.difficulty,
      chunkCount: params.chunks.length,
      ...(params.metadata ?? {})
    },
    modelOverride: MODEL
  });

  const rawText = response.choices[0]?.message?.content ?? "";
  if (!rawText) {
    logger.warn({}, "Verifier returned empty response");
    return { status: "FAILED", reason: "Verifier returned empty response" };
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawText);
  } catch {
    logger.warn({ rawPreview: rawText.slice(0, 300) }, "Verifier returned non-JSON response");
    return { status: "FAILED", reason: "Verifier returned non-JSON response" };
  }

  let result = normalizeVerifierResponse(rawJson);

  if (
    looksLikeMetadataQuestion(params.question) ||
    reasonSuggestsMetadataFailure(result.reason, result.failureCodes ?? [])
  ) {
    result = {
      status: "FAILED",
      reason:
        result.reason && result.reason !== "No reason provided"
          ? result.reason
          : "Question focuses on document metadata or structure rather than the actual study material",
      failureCodes: ensureFailureCode(result.failureCodes ?? [], "LOW_EDUCATIONAL_VALUE"),
      confidence: result.confidence ?? "HIGH"
    };
  }

  logger.info(
    {
      status: result.status,
      reason: result.reason.slice(0, 200),
      failureCodes: result.failureCodes ?? []
    },
    "Verifier result"
  );
  return result;
}
