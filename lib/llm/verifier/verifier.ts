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

function ensureFailureCodes(failureCodes: string[], codes: string[]): string[] {
  return codes.reduce((acc, code) => ensureFailureCode(acc, code), failureCodes);
}

function countMatches(value: string, pattern: RegExp): number {
  const matches = value.match(pattern);
  return matches ? matches.length : 0;
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function wordCount(value: string): number {
  return normalizeSpace(value).split(/\s+/).filter(Boolean).length;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4);
}

function hasReasoningSignal(value: string): boolean {
  return /\b(?:because|best explains|best describes|compared with|comparison|difference|distinguish|exception|how|implication|interpret|management|mechanism|most appropriate|most likely|next step|qualifier|reason|therefore|timing|underlying|versus|why)\b/.test(
    value
  );
}

function hasNuanceSignal(value: string): boolean {
  return /\b(?:although|compared with|despite|except|however|in contrast|instead|least likely|more likely|most likely|rather than|relative to|typically|unless|unlike|usually|when)\b/.test(
    value
  );
}

function tokenOverlapCount(a: string, b: string): number {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  let count = 0;
  for (const token of left) {
    if (right.has(token)) {
      count += 1;
    }
  }
  return count;
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

function styleRequestsHighRigor(styleProfile: unknown): boolean {
  if (!styleProfile || typeof styleProfile !== "object" || Array.isArray(styleProfile)) {
    return false;
  }

  const profile = styleProfile as Record<string, unknown>;
  const signals = [
    profile.explicitUserInstructions,
    profile.notes,
    profile.explanationTone,
    profile.distractorStyle
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return /\badvanced\b|\bapplied\b|\bboard-style\b|\bclinical\b|\bdiscriminat|\bexam[- ]style\b|\bfellowship\b|\bhigh[- ]level\b|\bmechanism\b|\bnuanced\b|\breasoning\b|\bscientific\b|\bspecialist\b|\btechnical\b/.test(
    signals
  );
}

function stemTelegraphsCorrectOption(question: GeneratedQuestion): boolean {
  if (question.type !== "MCQ" || !question.options || question.options.length !== 4) {
    return false;
  }

  const answerIndex = question.options.indexOf(question.answer);
  if (answerIndex === -1) {
    return false;
  }

  const stem = normalizeSpace(question.stem).toLowerCase();
  const answer = normalizeSpace(question.answer).toLowerCase();
  const directMention = answer.length >= 12 && stem.includes(answer);

  const overlaps = question.options.map((option) => tokenOverlapCount(question.stem, option));
  const correctOverlap = overlaps[answerIndex] ?? 0;
  const nextBestOverlap = overlaps
    .filter((_, index) => index !== answerIndex)
    .sort((a, b) => b - a)[0] ?? 0;

  return directMention || (correctOverlap >= 3 && correctOverlap >= nextBestOverlap + 2);
}

function mcqDistractorsLookWeak(question: GeneratedQuestion): boolean {
  if (question.type !== "MCQ" || !question.options || question.options.length !== 4) {
    return false;
  }

  const answerIndex = question.options.indexOf(question.answer);
  if (answerIndex === -1) {
    return false;
  }

  const distractors = question.options.filter((_, index) => index !== answerIndex);
  const answerWordCount = wordCount(question.answer);
  const distractorWordCounts = distractors.map((option) => wordCount(option));
  const averageDistractorLength =
    distractorWordCounts.reduce((sum, count) => sum + count, 0) / distractorWordCounts.length;
  const veryShortDistractors = distractorWordCounts.filter((count) => count <= 2).length;
  const genericDistractors = distractors.filter((option) =>
    /^(?:all of the above|none of the above|both|neither|unknown|not enough information)$/i.test(
      option.trim()
    )
  ).length;

  return (
    genericDistractors > 0 ||
    veryShortDistractors >= 2 ||
    (answerWordCount >= averageDistractorLength + 4 && veryShortDistractors >= 1)
  );
}

function looksLikeLowDepthTrueFalse(question: GeneratedQuestion): boolean {
  if (question.type !== "TRUE_FALSE") {
    return false;
  }

  const stem = normalizeSpace(question.stem);
  const normalized = stem.toLowerCase();
  const shortStem = wordCount(stem) <= 20;
  const obviousSummaryPattern =
    /\bis characterized by\b|\bis defined as\b|\bis caused by\b|\bis associated with\b|\bpresents with\b|\bresults in\b|\brefers to\b/.test(
      normalized
    );
  const absoluteTrap = /\b(?:always|never|all|none|only|entirely|exclusively)\b/.test(normalized);

  return (
    (shortStem && !hasReasoningSignal(normalized) && !hasNuanceSignal(normalized)) ||
    (obviousSummaryPattern && !hasNuanceSignal(normalized)) ||
    (absoluteTrap && shortStem && !hasNuanceSignal(normalized))
  );
}

function looksLikeLowDepthMcq(question: GeneratedQuestion): boolean {
  if (question.type !== "MCQ") {
    return false;
  }

  const stem = normalizeSpace(question.stem);
  const rationale = normalizeSpace(question.rationale);
  const normalizedStem = stem.toLowerCase();
  const shortDefinitionalStem =
    wordCount(stem) <= 16 &&
    /^(?:what is|which of the following is|which statement is|which term best describes|which feature is)/.test(
      normalizedStem
    );

  return (
    (shortDefinitionalStem && !hasReasoningSignal(normalizedStem)) ||
    (wordCount(stem) <= 12 &&
      wordCount(rationale) <= 24 &&
      !hasReasoningSignal(`${normalizedStem} ${rationale.toLowerCase()}`))
  );
}

function looksLowDepthForHighRigor(question: GeneratedQuestion): boolean {
  if (question.type === "TRUE_FALSE") {
    return looksLikeLowDepthTrueFalse(question);
  }

  if (question.type === "MCQ") {
    return (
      looksLikeLowDepthMcq(question) ||
      stemTelegraphsCorrectOption(question) ||
      mcqDistractorsLookWeak(question)
    );
  }

  const stem = normalizeSpace(question.stem);
  const rationale = normalizeSpace(question.rationale);
  const normalized = `${stem} ${rationale}`.toLowerCase();
  return wordCount(stem) <= 10 && wordCount(rationale) <= 24 && !hasReasoningSignal(normalized);
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
  styleProfile?: unknown;
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

  const user = [
    `Question JSON:\n${JSON.stringify(params.question)}`,
    `Style profile JSON:\n${JSON.stringify(params.styleProfile ?? {})}`,
    `Excerpts:\n${chunkMap}`
  ].join("\n\n");

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
  const highRigorRequested = styleRequestsHighRigor(params.styleProfile);

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

  if (highRigorRequested && looksLowDepthForHighRigor(params.question)) {
    const extraFailureCodes =
      params.question.type === "MCQ"
        ? ["LOW_EDUCATIONAL_VALUE", "WEAK_DISTRACTORS"]
        : params.question.type === "TRUE_FALSE"
          ? ["LOW_EDUCATIONAL_VALUE", "INVALID_TRUE_FALSE"]
          : ["LOW_EDUCATIONAL_VALUE"];
    result = {
      status: "FAILED",
      reason:
        result.status === "FAILED" && result.reason !== "No reason provided"
          ? result.reason
          : "Question is too basic for the requested exam-style or high-rigor question style",
      failureCodes: ensureFailureCodes(result.failureCodes ?? [], extraFailureCodes),
      confidence: result.confidence ?? "MEDIUM"
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
