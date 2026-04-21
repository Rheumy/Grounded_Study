import fs from "fs/promises";
import path from "path";
import { getOpenAIClient } from "@/lib/llm/openai";
import { logger } from "@/lib/observability/logger";
import type { GeneratedQuestion } from "@/lib/llm/schemas/question";
import {
  describeOutsiderForBackgroundLevel,
  normalizeAssumedBackgroundLevel,
  type AssumedBackgroundLevel
} from "@/lib/llm/schemas/style-profile";
import { VerifierSchema, type FailureCode } from "@/lib/llm/schemas/verifier";
import { recordOpenAiUsageEvent } from "@/lib/observability/ai-usage";

const MODEL = "gpt-4o-mini";

export type VerifierResult = {
  status: "PASSED" | "FAILED";
  reason: string;
  failureCodes?: FailureCode[];
  confidence?: "HIGH" | "MEDIUM" | "LOW";
};

const ALLOWED_FAILURE_CODES = new Set<FailureCode>([
  "UNSUPPORTED_STEM",
  "UNSUPPORTED_ANSWER",
  "UNSUPPORTED_RATIONALE",
  "AMBIGUOUS_QUESTION",
  "MULTIPLE_POSSIBLE_ANSWERS",
  "WEAK_DISTRACTORS",
  "INVALID_TRUE_FALSE",
  "OVERREACHING_MODEL_ANSWER",
  "MISSING_CITATIONS",
  "BAD_CITATION_LINKAGE",
  "RETRIEVAL_JARGON",
  "LOW_EDUCATIONAL_VALUE",
  "INVALID_STRUCTURE"
]);

function normalizeFailureCodes(raw: unknown): FailureCode[] {
  if (!Array.isArray(raw)) return [];

  return Array.from(
    new Set(
      raw
        .filter((code): code is string => typeof code === "string")
        .map((code) => code.trim().toUpperCase())
        .filter((code): code is FailureCode => ALLOWED_FAILURE_CODES.has(code as FailureCode))
    )
  );
}

function ensureFailureCode(failureCodes: FailureCode[], code: FailureCode): FailureCode[] {
  return failureCodes.includes(code) ? failureCodes : [...failureCodes, code];
}

function ensureFailureCodes(failureCodes: FailureCode[], codes: FailureCode[]): FailureCode[] {
  return codes.reduce((acc, code) => ensureFailureCode(acc, code), failureCodes);
}

function countMatches(value: string, pattern: RegExp): number {
  const matches = value.match(pattern);
  return matches ? matches.length : 0;
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeComparableText(value: string): string {
  return normalizeSpace(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "");
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

function rationaleRestatesStemOrAnswer(question: GeneratedQuestion): boolean {
  const rationale = normalizeComparableText(question.rationale);
  if (!rationale) {
    return true;
  }

  return (
    rationale === normalizeComparableText(question.stem) ||
    rationale === normalizeComparableText(question.answer)
  );
}

function citationExcerptAppearsInChunk(excerpt: string, chunkContent: string): boolean {
  const normalizedExcerpt = normalizeComparableText(excerpt);
  const normalizedChunk = normalizeComparableText(chunkContent);

  if (!normalizedExcerpt || normalizedExcerpt.length < 5) {
    return false;
  }

  return normalizedChunk.includes(normalizedExcerpt);
}

function findCitationLinkageFailure(params: {
  question: GeneratedQuestion;
  chunks: { id: string; content: string; page: number | null }[];
}): VerifierResult | null {
  if (params.question.citations.length === 0) {
    return {
      status: "FAILED",
      reason: "Question is missing supporting citations",
      failureCodes: ["MISSING_CITATIONS"],
      confidence: "HIGH"
    };
  }

  const chunkMap = new Map(params.chunks.map((chunk) => [chunk.id, chunk]));
  for (const citation of params.question.citations) {
    const chunk = chunkMap.get(citation.chunkId);
    if (!chunk) {
      return {
        status: "FAILED",
        reason: "Citation references an unknown chunk",
        failureCodes: ["BAD_CITATION_LINKAGE"],
        confidence: "HIGH"
      };
    }

    if (!citationExcerptAppearsInChunk(citation.excerpt, chunk.content)) {
      return {
        status: "FAILED",
        reason: "Citation excerpt does not match the cited evidence",
        failureCodes: ["BAD_CITATION_LINKAGE"],
        confidence: "HIGH"
      };
    }
  }

  return null;
}

function buildMcqChallengeContext(question: GeneratedQuestion): string | null {
  if (question.type !== "MCQ" || !question.options || question.options.length !== 4) {
    return null;
  }

  const distractors = question.options.filter((option) => option !== question.answer);
  if (distractors.length === 0) {
    return null;
  }

  const scoredDistractors = distractors.map((option) => ({
    option,
    score:
      tokenOverlapCount(question.stem, option) * 3 +
      tokenOverlapCount(question.answer, option) * 2 +
      Math.max(0, 3 - Math.abs(wordCount(question.answer) - wordCount(option)))
  }));

  const nearest = scoredDistractors.sort((a, b) => b.score - a.score)[0]?.option;
  if (!nearest) {
    return null;
  }

  return [
    "MCQ answer-key challenge:",
    `- Keyed answer: ${question.answer}`,
    `- Nearest competing distractor: ${nearest}`,
    "- Decide whether the cited evidence makes the keyed answer clearly stronger than this distractor.",
    "- If the distractor is still reasonably defensible, the item must fail."
  ].join("\n");
}

function buildTrueFalseChallengeContext(question: GeneratedQuestion): string | null {
  if (question.type !== "TRUE_FALSE") {
    return null;
  }

  return [
    "True/False challenge:",
    `- Proposed truth value: ${question.answer}`,
    "- Check whether the statement remains clearly true or false without adding missing qualifiers, hidden assumptions, or external context.",
    "- If the truth value changes under a reasonable reading of the provided evidence, the item must fail."
  ].join("\n");
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
  if (getAssumedBackgroundLevel(styleProfile) === "specialist") {
    return true;
  }

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

function getAssumedBackgroundLevel(styleProfile: unknown): AssumedBackgroundLevel {
  if (!styleProfile || typeof styleProfile !== "object" || Array.isArray(styleProfile)) {
    return "generalist";
  }

  return normalizeAssumedBackgroundLevel(
    (styleProfile as Record<string, unknown>).assumedBackgroundLevel
  );
}

function buildOutsiderChallengeContext(styleProfile: unknown): string {
  const assumedBackgroundLevel = getAssumedBackgroundLevel(styleProfile);
  const outsiderDefinition = describeOutsiderForBackgroundLevel(assumedBackgroundLevel);

  return [
    "Outsider Test pre-flight:",
    `- assumedBackgroundLevel: ${assumedBackgroundLevel}`,
    `- outsider: ${outsiderDefinition}`,
    "- Before any other check, decide whether this outsider could answer correctly without reading the cited evidence.",
    "- If yes, the question must fail with LOW_EDUCATIONAL_VALUE.",
    "- A passing question must depend on a source-specific qualifier, exception, threshold, mechanism, timing detail, contextual distinction, comparison, or applied detail."
  ].join("\n");
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

function findOutsiderHeuristicFailure(params: {
  question: GeneratedQuestion;
  assumedBackgroundLevel: AssumedBackgroundLevel;
  highRigorRequested: boolean;
}): VerifierResult | null {
  if (params.question.type === "TRUE_FALSE" && looksLikeLowDepthTrueFalse(params.question)) {
    const reason =
      params.assumedBackgroundLevel === "novice"
        ? "True/false statement is too broad or telegraphed to require the cited source"
        : "True/false statement reads like a field-general summary that could be answered without studying the cited source";

    return {
      status: "FAILED",
      reason,
      failureCodes: ["LOW_EDUCATIONAL_VALUE", "INVALID_TRUE_FALSE"],
      confidence: "MEDIUM"
    };
  }

  if (params.question.type === "MCQ" && stemTelegraphsCorrectOption(params.question)) {
    return {
      status: "FAILED",
      reason: "MCQ stem telegraphs the answer instead of requiring grounded use of the source",
      failureCodes: ["LOW_EDUCATIONAL_VALUE", "WEAK_DISTRACTORS"],
      confidence: "MEDIUM"
    };
  }

  if (
    params.question.type === "MCQ" &&
    (params.highRigorRequested || params.assumedBackgroundLevel !== "novice") &&
    (looksLikeLowDepthMcq(params.question) || mcqDistractorsLookWeak(params.question))
  ) {
    return {
      status: "FAILED",
      reason:
        params.assumedBackgroundLevel === "specialist"
          ? "MCQ is too field-general for a specialist-style source and does not require the specific material"
          : "MCQ is too general or weakly discriminative to require the cited source",
      failureCodes: ["LOW_EDUCATIONAL_VALUE", "WEAK_DISTRACTORS"],
      confidence: "MEDIUM"
    };
  }

  return null;
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

  const failureCodes = normalizeFailureCodes(obj.failureCodes ?? obj.failure_codes ?? obj.failures);
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

  const citationFailure = findCitationLinkageFailure(params);
  if (citationFailure) {
    logger.info(
      {
        questionType: params.question.type,
        failureCodes: citationFailure.failureCodes ?? [],
        reason: citationFailure.reason
      },
      "Verifier rejected question before LLM review"
    );
    return citationFailure;
  }

  const chunkMap = params.chunks
    .map((chunk) => `Chunk ${chunk.id} (page ${chunk.page ?? "n/a"}): ${chunk.content}`)
    .join("\n\n");
  const mcqChallengeContext = buildMcqChallengeContext(params.question);
  const trueFalseChallengeContext = buildTrueFalseChallengeContext(params.question);
  const outsiderChallengeContext = buildOutsiderChallengeContext(params.styleProfile);

  const user = [
    outsiderChallengeContext,
    `Question JSON:\n${JSON.stringify(params.question)}`,
    `Style profile JSON:\n${JSON.stringify(params.styleProfile ?? {})}`,
    mcqChallengeContext,
    trueFalseChallengeContext,
    `Excerpts:\n${chunkMap}`
  ]
    .filter(Boolean)
    .join("\n\n");

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
      assumedBackgroundLevel: getAssumedBackgroundLevel(params.styleProfile),
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
  const parsedResult = VerifierSchema.safeParse(result);
  if (!parsedResult.success) {
    logger.warn(
      {
        issues: parsedResult.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      },
      "Verifier returned invalid normalized payload"
    );
    result = { status: "FAILED", reason: "Verifier returned invalid response" };
  } else {
    result = parsedResult.data;
  }
  const highRigorRequested = styleRequestsHighRigor(params.styleProfile);
  const assumedBackgroundLevel = getAssumedBackgroundLevel(params.styleProfile);

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

  if (rationaleRestatesStemOrAnswer(params.question)) {
    result = {
      status: "FAILED",
      reason:
        result.status === "FAILED" && result.reason !== "No reason provided"
          ? result.reason
          : "Rationale does not explain the answer beyond restating the stem or answer",
      failureCodes: ensureFailureCodes(result.failureCodes ?? [], [
        "UNSUPPORTED_RATIONALE",
        "LOW_EDUCATIONAL_VALUE"
      ]),
      confidence: result.confidence ?? "HIGH"
    };
  }

  const outsiderHeuristicFailure = findOutsiderHeuristicFailure({
    question: params.question,
    assumedBackgroundLevel,
    highRigorRequested
  });
  if (outsiderHeuristicFailure) {
    result = {
      status: "FAILED",
      reason:
        result.status === "FAILED" && result.reason !== "No reason provided"
          ? result.reason
          : outsiderHeuristicFailure.reason,
      failureCodes: ensureFailureCodes(
        result.failureCodes ?? [],
        outsiderHeuristicFailure.failureCodes ?? ["LOW_EDUCATIONAL_VALUE"]
      ),
      confidence: result.confidence ?? outsiderHeuristicFailure.confidence ?? "MEDIUM"
    };
  }

  if (highRigorRequested && looksLowDepthForHighRigor(params.question)) {
    const extraFailureCodes: FailureCode[] =
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
