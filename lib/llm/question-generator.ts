import fs from "fs/promises";
import path from "path";
import { getOpenAIClient } from "@/lib/llm/openai";
import { GeneratedQuestionSchema, type GeneratedQuestion } from "@/lib/llm/schemas/question";
import {
  describeOutsiderForBackgroundLevel,
  normalizeAssumedBackgroundLevel,
  type AssumedBackgroundLevel
} from "@/lib/llm/schemas/style-profile";
import { logger } from "@/lib/observability/logger";
import { recordOpenAiUsageEvent } from "@/lib/observability/ai-usage";

const MODEL = "gpt-4o-mini";

export type RetrievalChunk = {
  id: string;
  content: string;
  page: number | null;
};

type NormalizedCitation = {
  chunkId: string;
  excerpt: string;
  page: number | null;
};

type FuzzyChunkToken = {
  value: string;
  start: number;
  end: number;
};

const MIN_FUZZY_CITATION_TOKENS = 5;
const MAX_FUZZY_CITATION_TOKENS = 24;
const MAX_FUZZY_CITATION_CHARS = 220;
const MIN_FUZZY_MATCH_DENSITY = 0.65;
const MAX_FUZZY_EXTRA_TOKENS = 4;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function countMatches(value: string, pattern: RegExp): number {
  const matches = value.match(pattern);
  return matches ? matches.length : 0;
}

function getSourceSpecificFocusScore(content: string): number {
  const normalized = collapseWhitespace(content).toLowerCase();

  if (!normalized) {
    return 0;
  }

  return (
    countMatches(
      normalized,
      /\b(?:after|although|before|compared with|compared to|despite|except|however|if|in contrast|instead|less than|more than|only if|only when|prior to|rather than|relative to|subsequent|then|unless|versus|vs\.?|when|whereas|within|without)\b/g
    ) * 2 +
    countMatches(
      normalized,
      /\b(?:caveat|component|condition|contraindication|criteria|criterion|exception|implication|limitation|order|prerequisite|required|requirement|sequence|step|threshold|timing)\b/g
    ) * 2 +
    countMatches(normalized, /\b(?:first|second|third|final|initial|next)\b/g) +
    countMatches(normalized, /\b\d+(?:\.\d+)?(?:%|x)?\b/g)
  );
}

function extractSourceSpecificFocusSnippet(content: string): string | null {
  const collapsed = collapseWhitespace(content);
  if (!collapsed) {
    return null;
  }

  const focusPattern =
    /\b(?:after|although|before|caveat|compared with|compared to|component|condition|contraindication|criteria|criterion|exception|first|however|if|implication|initial|limitation|next|only if|only when|order|prerequisite|prior to|required|requirement|sequence|step|subsequent|then|threshold|timing|unless|versus|vs\.?|when|whereas|within|\d+(?:\.\d+)?(?:%|x)?)\b/i;
  const match = focusPattern.exec(collapsed);

  if (!match) {
    return null;
  }

  const start = Math.max(0, match.index - 90);
  return collapsed.slice(start, start + 220);
}

function buildRetryFocusCue(chunks: RetrievalChunk[]): string | null {
  const bestChunk = chunks
    .map((chunk) => ({
      chunk,
      score: getSourceSpecificFocusScore(chunk.content)
    }))
    .sort((a, b) => b.score - a.score)[0];

  if (!bestChunk || bestChunk.score <= 0) {
    return null;
  }

  return extractSourceSpecificFocusSnippet(bestChunk.chunk.content);
}

function stripWrappingQuotes(value: string): string {
  return value
    .replace(/^[\s"'`“”‘’]+/, "")
    .replace(/[\s"'`“”‘’]+$/, "")
    .trim();
}

function normalizeComparableCharacter(value: string): string {
  if (/\s/.test(value)) {
    return " ";
  }

  switch (value) {
    case "“":
    case "”":
    case "„":
    case "‟":
      return '"';
    case "‘":
    case "’":
    case "‚":
    case "‛":
      return "'";
    case "–":
    case "—":
    case "−":
      return "-";
    default:
      return value.toLowerCase();
  }
}

function buildComparableIndex(value: string): { normalized: string; originalIndexes: number[] } {
  let normalized = "";
  const originalIndexes: number[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const nextChar = normalizeComparableCharacter(value[index]);

    if (nextChar === " ") {
      if (normalized.length === 0 || normalized.endsWith(" ")) {
        continue;
      }
    }

    normalized += nextChar;
    originalIndexes.push(index);
  }

  if (normalized.endsWith(" ")) {
    normalized = normalized.slice(0, -1);
    originalIndexes.pop();
  }

  return { normalized, originalIndexes };
}

function findComparableSubstring(chunkContent: string, excerpt: string): string | null {
  const normalizedExcerpt = buildComparableIndex(excerpt).normalized;
  if (!normalizedExcerpt) {
    return null;
  }

  const comparableChunk = buildComparableIndex(chunkContent);
  const matchIndex = comparableChunk.normalized.indexOf(normalizedExcerpt);
  if (matchIndex === -1) {
    return null;
  }

  const originalStart = comparableChunk.originalIndexes[matchIndex];
  const originalEnd =
    comparableChunk.originalIndexes[matchIndex + normalizedExcerpt.length - 1];

  if (originalStart == null || originalEnd == null) {
    return null;
  }

  return chunkContent.slice(originalStart, originalEnd + 1);
}

function normalizeFuzzyCitationText(value: string): string {
  let normalized = "";
  let previousWasSpace = true;

  for (const char of value) {
    if (/[a-z0-9]/i.test(char)) {
      normalized += char.toLowerCase();
      previousWasSpace = false;
      continue;
    }

    if (/\s/.test(char)) {
      if (!previousWasSpace && normalized.length > 0) {
        normalized += " ";
        previousWasSpace = true;
      }
    }
  }

  return normalized.trim();
}

function buildFuzzyChunkTokenIndex(value: string): FuzzyChunkToken[] {
  const tokens: FuzzyChunkToken[] = [];
  let tokenValue = "";
  let tokenStart = -1;
  let tokenEnd = -1;

  const flushToken = () => {
    if (!tokenValue) {
      return;
    }

    tokens.push({
      value: tokenValue,
      start: tokenStart,
      end: tokenEnd
    });
    tokenValue = "";
    tokenStart = -1;
    tokenEnd = -1;
  };

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (/[a-z0-9]/i.test(char)) {
      if (!tokenValue) {
        tokenStart = index;
      }

      tokenValue += char.toLowerCase();
      tokenEnd = index;
      continue;
    }

    if (/\s/.test(char)) {
      flushToken();
    }
  }

  flushToken();

  return tokens;
}

function findNextMatchingChunkTokenIndex(
  chunkTokens: FuzzyChunkToken[],
  startIndex: number,
  excerptToken: string
): number {
  for (let index = startIndex; index < chunkTokens.length; index += 1) {
    if (chunkTokens[index]?.value === excerptToken) {
      return index;
    }
  }

  return -1;
}

function findFuzzyCitationSubstring(chunkContent: string, excerpt: string): string | null {
  const normalizedExcerpt = normalizeFuzzyCitationText(excerpt);
  if (!normalizedExcerpt || normalizedExcerpt.length > MAX_FUZZY_CITATION_CHARS) {
    return null;
  }

  const excerptTokens = normalizedExcerpt.split(" ").filter(Boolean);
  if (
    excerptTokens.length < MIN_FUZZY_CITATION_TOKENS ||
    excerptTokens.length > MAX_FUZZY_CITATION_TOKENS
  ) {
    return null;
  }

  const chunkTokens = buildFuzzyChunkTokenIndex(chunkContent);
  if (chunkTokens.length === 0) {
    return null;
  }

  const minimumMatches = Math.ceil(excerptTokens.length * 0.8);
  let bestMatch:
    | {
        start: number;
        end: number;
        matchedCount: number;
        spanTokenCount: number;
      }
    | null = null;

  for (let startIndex = 0; startIndex < chunkTokens.length; startIndex += 1) {
    let chunkCursor = startIndex;
    let firstMatchIndex = -1;
    let lastMatchIndex = -1;
    let matchedCount = 0;

    for (const excerptToken of excerptTokens) {
      const matchedIndex = findNextMatchingChunkTokenIndex(chunkTokens, chunkCursor, excerptToken);

      if (matchedIndex === -1) {
        continue;
      }

      if (firstMatchIndex === -1) {
        firstMatchIndex = matchedIndex;
      }

      lastMatchIndex = matchedIndex;
      matchedCount += 1;
      chunkCursor = matchedIndex + 1;

      if (matchedCount < minimumMatches) {
        continue;
      }

      const spanTokenCount = lastMatchIndex - firstMatchIndex + 1;
      const matchDensity = matchedCount / spanTokenCount;
      if (
        matchDensity < MIN_FUZZY_MATCH_DENSITY ||
        spanTokenCount > excerptTokens.length + MAX_FUZZY_EXTRA_TOKENS
      ) {
        continue;
      }

      const candidate = {
        start: chunkTokens[firstMatchIndex]?.start ?? -1,
        end: chunkTokens[lastMatchIndex]?.end ?? -1,
        matchedCount,
        spanTokenCount
      };

      if (candidate.start === -1 || candidate.end === -1) {
        continue;
      }

      if (
        !bestMatch ||
        candidate.spanTokenCount < bestMatch.spanTokenCount ||
        (candidate.spanTokenCount === bestMatch.spanTokenCount &&
          candidate.matchedCount > bestMatch.matchedCount) ||
        (candidate.spanTokenCount === bestMatch.spanTokenCount &&
          candidate.matchedCount === bestMatch.matchedCount &&
          candidate.start < bestMatch.start)
      ) {
        bestMatch = candidate;
      }

      break;
    }
  }

  if (!bestMatch) {
    return null;
  }

  return chunkContent.slice(bestMatch.start, bestMatch.end + 1);
}

function truncate(content: string, max = 800) {
  if (content.length <= max) return content;
  return `${content.slice(0, max)}...`;
}

function getDifficultyDescriptor(styleProfile: unknown, difficulty: number): string | null {
  if (!styleProfile || typeof styleProfile !== "object" || Array.isArray(styleProfile)) {
    return null;
  }

  const difficultyMap = (styleProfile as Record<string, unknown>).difficultyMap;
  if (!difficultyMap || typeof difficultyMap !== "object" || Array.isArray(difficultyMap)) {
    return null;
  }

  const value = (difficultyMap as Record<string, unknown>)[String(difficulty)];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getExplicitStyleDirectives(styleProfile: unknown): string | null {
  if (!styleProfile || typeof styleProfile !== "object" || Array.isArray(styleProfile)) {
    return null;
  }

  const value = (styleProfile as Record<string, unknown>).explicitUserInstructions;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function collectStyleSignals(styleProfile: unknown): string {
  if (!styleProfile || typeof styleProfile !== "object" || Array.isArray(styleProfile)) {
    return "";
  }

  const profile = styleProfile as Record<string, unknown>;
  return [
    profile.explicitUserInstructions,
    profile.notes,
    profile.explanationTone,
    profile.distractorStyle
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

function getAssumedBackgroundLevel(styleProfile: unknown): AssumedBackgroundLevel {
  if (!styleProfile || typeof styleProfile !== "object" || Array.isArray(styleProfile)) {
    return "generalist";
  }

  return normalizeAssumedBackgroundLevel(
    (styleProfile as Record<string, unknown>).assumedBackgroundLevel
  );
}

function styleRequestsHighRigor(styleProfile: unknown): boolean {
  if (getAssumedBackgroundLevel(styleProfile) === "specialist") {
    return true;
  }

  const signals = collectStyleSignals(styleProfile);
  return /\badvanced\b|\bapplied\b|\bboard-style\b|\bclinical\b|\bdiscriminat|\bexam[- ]style\b|\bfellowship\b|\bhigh[- ]level\b|\bmechanism\b|\bnuanced\b|\breasoning\b|\bscientific\b|\bspecialist\b|\btechnical\b/.test(
    signals
  );
}

function buildHighRigorGuidance(
  requestedType: "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE",
  styleProfile: unknown
): string | null {
  if (!styleRequestsHighRigor(styleProfile)) {
    return null;
  }

  const lines = [
    "Treat the requested advanced or exam-style rigor as a strong priority whenever the material supports it.",
    "Prefer questions that separate superficial familiarity from precise grounded understanding.",
    "Do not let the stem telegraph the answer through obvious wording, simplistic absolutes, or by echoing only one option."
  ];

  if (requestedType === "MCQ") {
    lines.push(
      "Use four options from the same conceptual family where possible.",
      "Make at least two or three distractors plausible to a partially knowledgeable learner.",
      "The correct answer should win because of a subtle but meaningful grounded distinction, not because it is the only clearly relevant option."
    );
  } else if (requestedType === "TRUE_FALSE") {
    lines.push(
      "Use a nuanced, clearly decidable proposition whose truth value depends on a qualifier, exception, mechanism, timing detail, context, or other meaningful grounded distinction.",
      "Do not default to broad summary statements or easy absolute traps."
    );
  } else {
    lines.push(
      "Ask for a precise distinction, implication, mechanism, comparison, or application that rewards deep understanding rather than headline recall."
    );
  }

  return lines.map((line) => `- ${line}`).join("\n");
}

function buildOutsiderTestContext(styleProfile: unknown): string {
  const assumedBackgroundLevel = getAssumedBackgroundLevel(styleProfile);
  const outsiderDefinition = describeOutsiderForBackgroundLevel(assumedBackgroundLevel);

  return [
    "Outsider Test calibration:",
    `- assumedBackgroundLevel: ${assumedBackgroundLevel}`,
    `- outsider: ${outsiderDefinition}`,
    "- A passing question must require a source-specific qualifier, exception, threshold, mechanism, timing detail, contextual distinction, comparison, or applied detail.",
    "- Judge the exact stem or proposition, not the fame or familiarity of the overall topic.",
    "- If this outsider could answer this exact stem or proposition correctly without the specific cited detail, return INSUFFICIENT_EVIDENCE.",
    "- Do not reject solely because the broader topic is familiar, widely taught, or clinically important.",
    '- Avoid overview stems such as "what is X", "what does X do", "role of X", "mechanism of X", or "how X works" unless the stem itself is narrowed by a source-specific detail.',
    "- In generalist mode, a familiar topic is still acceptable only when the exact tested claim depends on the source-specific detail."
  ].join("\n");
}

function buildOverviewAvoidanceGuidance(params: {
  requestedType: "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE";
  styleProfile: unknown;
}): string {
  const assumedBackgroundLevel = getAssumedBackgroundLevel(params.styleProfile);
  const lines = [
    "Anti-overview rule:",
    "- Do not ask for a topic overview, headline summary, or field-general explanation.",
    '- Avoid stems such as "what is X", "what does X do", "role of X", "mechanism of X", "why is X important", or "how X works" unless the stem itself includes a source-specific qualifier, comparison, threshold, condition, limitation, sequence detail, required component, or caveat.'
  ];

  if (assumedBackgroundLevel === "generalist") {
    lines.push(
      "- In generalist mode, the topic may be familiar, but the exact tested claim must still depend on a specific detail from the source."
    );
  }

  if (params.requestedType === "MCQ") {
    lines.push(
      "- For MCQ, avoid asking which option best describes a topic in general; ask which option is supported only because of a narrower source-bound detail."
    );
  } else if (params.requestedType === "TRUE_FALSE") {
    lines.push(
      "- For TRUE_FALSE, avoid broad mechanism or role statements; use a proposition whose truth value turns on a source-specific qualifier, comparison, timing detail, condition, limitation, or caveat."
    );
  } else {
    lines.push(
      "- For SHORT_ANSWER, do not ask for a generic explanation of a familiar concept; ask for a precise distinction, implication, sequence detail, condition, or required component supported by the source."
    );
  }

  return lines.join("\n");
}

function buildRetryGuidance(params: {
  retryContext?:
    | {
        strategy: "default" | "narrow_source_specific";
        previousFailureReason?: string | null;
      }
    | undefined;
  requestedType: "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE";
  chunks: RetrievalChunk[];
}): string | null {
  if (!params.retryContext || params.retryContext.strategy !== "narrow_source_specific") {
    return null;
  }

  const lines = [
    "Retry guidance:",
    "- A previous attempt was rejected because it was too general or could be answered without the specific cited detail.",
    "- Do not ask about the topic at headline level.",
    '- Avoid overview stems such as "what is X", "what does X do", "role of X", "mechanism of X", "importance of X", or "how X works".',
    "- Pivot to a narrower proposition that depends on a qualifier, exception, threshold, comparison, timing detail, contextual distinction, mechanism nuance, implication, criteria, caveat, contraindication, condition, limitation, sequence or order detail, or required component if the source supports it."
  ];

  if (params.retryContext.previousFailureReason) {
    lines.push(`- Previous failure reason: ${params.retryContext.previousFailureReason}`);
  }

  const focusCue = buildRetryFocusCue(params.chunks);
  if (focusCue) {
    lines.push(`- Prefer centering the next attempt on a detail like: ${focusCue}`);
  }

  if (params.requestedType === "MCQ") {
    lines.push(
      "- Make the keyed answer win because of that narrower source-specific detail, not because it is the only obviously relevant option."
    );
  } else if (params.requestedType === "TRUE_FALSE") {
    lines.push(
      "- Write a source-specific proposition whose truth value turns on that narrower detail, not on a broad summary claim."
    );
  } else {
    lines.push(
      "- Ask for a concise explanation or implication that clearly depends on the narrower cited detail."
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Option normalisation
// The model sometimes returns options as objects with a "text", "value", or
// "label" key instead of plain strings.
// ---------------------------------------------------------------------------
function extractOptionText(opt: unknown): string {
  if (typeof opt === "string") return collapseWhitespace(opt);
  if (opt !== null && typeof opt === "object" && !Array.isArray(opt)) {
    const o = opt as Record<string, unknown>;
    const val = o.text ?? o.value ?? o.content ?? o.label ?? o.option ?? o.answer;
    if (val !== undefined) return collapseWhitespace(String(val));
  }
  return collapseWhitespace(String(opt ?? ""));
}

function normalizeAnswerMatchKey(value: string): string {
  return collapseWhitespace(value)
    .replace(/^[A-D][\)\.\:\-]\s*/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "");
}

function canonicalizeMcqAnswer(answer: string, options: string[]): string {
  const trimmed = collapseWhitespace(answer);
  if (/^[A-D]$/i.test(trimmed)) {
    const letterIndex = trimmed.toUpperCase().charCodeAt(0) - 65;
    if (options[letterIndex]) {
      return options[letterIndex];
    }
  }

  const answerKey = normalizeAnswerMatchKey(trimmed);
  const matchedOption = options.find((option) => normalizeAnswerMatchKey(option) === answerKey);
  return matchedOption ?? trimmed;
}

function canonicalizeTrueFalseAnswer(answer: string): string {
  const normalized = collapseWhitespace(answer).toLowerCase();
  if (["true", "t", "yes"].includes(normalized)) return "True";
  if (["false", "f", "no"].includes(normalized)) return "False";
  return collapseWhitespace(answer);
}

// ---------------------------------------------------------------------------
// Citation normalisation
// The model may use different field names for chunk ID and excerpt text.
// ---------------------------------------------------------------------------
function normalizeCitation(c: unknown): NormalizedCitation {
  if (!c || typeof c !== "object" || Array.isArray(c)) {
    return { chunkId: String(c ?? ""), excerpt: "", page: null };
  }
  const obj = c as Record<string, unknown>;
  const pageCandidate = obj.page ?? obj.pageNumber ?? null;
  const numericPage = pageCandidate != null ? Number(pageCandidate) : null;
  return {
    chunkId: collapseWhitespace(
      String(obj.chunkId ?? obj.chunk_id ?? obj.id ?? obj.source ?? "")
    ),
    excerpt: collapseWhitespace(
      String(obj.excerpt ?? obj.quote ?? obj.text ?? obj.content ?? obj.passage ?? "")
    ),
    page: Number.isInteger(numericPage) ? numericPage : null
  };
}

function repairCitationAgainstChunks(params: {
  citation: NormalizedCitation;
  chunksById: Map<string, RetrievalChunk>;
  requestedType: "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE";
}): NormalizedCitation | null {
  const chunk = params.chunksById.get(params.citation.chunkId);

  if (!chunk) {
    logger.warn(
      {
        requestedType: params.requestedType,
        chunkId: params.citation.chunkId,
        excerptMatch: "failure",
        repairAttempted: false,
        failureBucket: "BAD_CITATION_LINKAGE"
      },
      "Citation referenced an unknown chunk during generation"
    );
    throw new Error(`Citation references unknown chunk: ${params.citation.chunkId}`);
  }

  const excerptCandidates = [...new Set([
    params.citation.excerpt,
    stripWrappingQuotes(params.citation.excerpt)
  ])].filter((candidate) => candidate.length > 0);

  for (const candidate of excerptCandidates) {
    if (chunk.content.includes(candidate)) {
      logger.info(
        {
          requestedType: params.requestedType,
          chunkId: params.citation.chunkId,
          excerptMatch: "success",
          repairAttempted: candidate !== params.citation.excerpt,
          failureBucket: null
        },
        "Citation excerpt matched source chunk during generation"
      );
      return {
        ...params.citation,
        excerpt: candidate
      };
    }
  }

  for (const candidate of excerptCandidates) {
    const repairedExcerpt = findComparableSubstring(chunk.content, candidate);
    if (repairedExcerpt) {
      logger.info(
        {
          requestedType: params.requestedType,
          chunkId: params.citation.chunkId,
          excerptMatch: "success",
          repairAttempted: true,
          failureBucket: null
        },
        "Citation excerpt repaired to exact chunk text during generation"
      );
      return {
        ...params.citation,
        excerpt: repairedExcerpt
      };
    }
  }

  for (const candidate of excerptCandidates) {
    const repairedExcerpt = findFuzzyCitationSubstring(chunk.content, candidate);
    if (repairedExcerpt) {
      logger.info(
        {
          requestedType: params.requestedType,
          chunkId: params.citation.chunkId,
          repaired: true
        },
        "Citation excerpt repaired via fuzzy alignment"
      );
      return {
        ...params.citation,
        excerpt: repairedExcerpt
      };
    }
  }

  logger.warn(
    {
      requestedType: params.requestedType,
      chunkId: params.citation.chunkId,
      excerptMatch: "failure",
      repairAttempted: excerptCandidates.length > 0,
      failureBucket: "BAD_CITATION_LINKAGE"
    },
    "Citation excerpt could not be matched to source chunk during generation"
  );

  return null;
}

// ---------------------------------------------------------------------------
// Raw → canonical normalisation
// Converts whatever the model returns into the shape expected by
// GeneratedQuestionSchema.  verifierStatus is always set by app code here —
// we never require the model to produce it, but do honour INSUFFICIENT_EVIDENCE
// if the model explicitly signals it.
// ---------------------------------------------------------------------------
function normalizeRawQuestion(
  raw: unknown,
  requestedType: "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE",
  requestedDifficulty: number
): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Unexpected raw LLM shape: ${typeof raw}`);
  }

  let obj = raw as Record<string, unknown>;

  // Preserve outer-level citations before potentially unwrapping a nested
  // "question" object — the model sometimes puts citations at the outer level.
  const outerCitations =
    obj.citations ?? obj.references ?? obj.sources ?? obj.evidence;

  // Unwrap common single-key nesting patterns, e.g. { "question": {...} }
  // Only unwrap if the top level doesn't already look like a question itself.
  if (!obj.type && !obj.stem && !obj.question_text) {
    // Also handle array wrapping: { "questions": [{...}] } → take first element
    for (const arrKey of ["questions", "items", "results"]) {
      const arr = obj[arrKey];
      if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === "object" && arr[0] !== null) {
        obj = arr[0] as Record<string, unknown>;
        break;
      }
    }
    for (const wrapKey of [
      "question",
      "generated_question",
      "question_data",
      "questionData",
      "result",
      "output",
      "data",
      "generated"
    ]) {
      const candidate = obj[wrapKey];
      if (
        candidate !== null &&
        typeof candidate === "object" &&
        !Array.isArray(candidate)
      ) {
        obj = candidate as Record<string, unknown>;
        break;
      }
    }
  }

  // --- type ---
  let type: string = String(obj.type ?? requestedType);
  type = type.toUpperCase().replace(/[-\s]/g, "_");
  // Normalise common aliases
  if (type === "MULTIPLE_CHOICE" || type === "MULTIPLE_CHOICE_QUESTION") type = "MCQ";
  if (type === "SHORT_ANSWER_QUESTION" || type === "SHORTANSWER" || type === "OPEN_ENDED") {
    type = "SHORT_ANSWER";
  }
  if (
    type === "TRUEFALSE" ||
    type === "TRUE_FALSE_QUESTION" ||
    type === "T_F" ||
    type === "TF"
  ) {
    type = "TRUE_FALSE";
  }
  // If still not a recognised type, fall back to what was requested
  if (!["MCQ", "SHORT_ANSWER", "TRUE_FALSE"].includes(type)) {
    type = requestedType;
  }

  // --- stem ---
  const stem = String(
    obj.stem ?? obj.question ?? obj.question_text ?? obj.text ?? obj.prompt ?? ""
  ).trim();

  // --- options ---
  let options: string[] | undefined;
  const rawOptions = obj.options ?? obj.choices ?? obj.answers_list ?? obj.answer_choices;
  if (Array.isArray(rawOptions) && rawOptions.length > 0) {
    options = rawOptions.map(extractOptionText).filter((s) => s.length > 0);
  }

  // TRUE_FALSE always gets exactly ["True", "False"] regardless of model output
  if (type === "TRUE_FALSE") {
    options = ["True", "False"];
  }

  // SHORT_ANSWER should have no options
  if (type === "SHORT_ANSWER") {
    options = undefined;
  }

  // --- answer ---
  let answer = String(obj.answer ?? obj.correct_answer ?? obj.correctAnswer ?? "").trim();

  // MCQ: enforce exactly 4 options.
  // If the model returns more than 4, keep the correct answer option plus the
  // first 3 of the remaining options. This handles the common 5-option mistake.
  if (type === "MCQ" && options && options.length > 4) {
    const answerIdx = options.indexOf(answer);
    if (answerIdx !== -1) {
      const others = options.filter((_, i) => i !== answerIdx);
      options = [answer, ...others.slice(0, 3)];
    } else {
      options = options.slice(0, 4);
    }
  }

  if (type === "MCQ" && options) {
    answer = canonicalizeMcqAnswer(answer, options);
  }

  if (type === "TRUE_FALSE") {
    answer = canonicalizeTrueFalseAnswer(answer);
  }

  // --- rationale ---
  const rationale = String(
    obj.rationale ?? obj.explanation ?? obj.reasoning ?? obj.justification ?? ""
  ).trim();

  // --- citations ---
  // Fall back to outer-level citations when the model wraps the question in a
  // nested object — citations are sometimes placed outside the inner wrapper.
  const innerCitations = obj.citations ?? obj.references ?? obj.sources ?? obj.evidence;
  const rawCitations = Array.isArray(innerCitations) && innerCitations.length > 0
    ? innerCitations
    : outerCitations;
  const citations: unknown[] = Array.isArray(rawCitations)
    ? rawCitations.map(normalizeCitation)
    : [];

  // --- difficulty ---
  let difficulty = Number(obj.difficulty ?? requestedDifficulty);
  if (!Number.isFinite(difficulty) || difficulty < 1 || difficulty > 5) {
    difficulty = requestedDifficulty;
  }
  difficulty = Math.round(difficulty);

  // --- tags ---
  let tags: string[] | undefined;
  if (Array.isArray(obj.tags)) {
    tags = obj.tags.map((t) => String(t)).filter(Boolean);
    if (tags.length === 0) tags = undefined;
  }

  // --- verifierStatus (app code, not model) ---
  // verifierStatus is always set by app code. We honour INSUFFICIENT_EVIDENCE
  // if the model explicitly signals it; all other values → PENDING.
  // Known model aliases for "not enough evidence":
  //   INSUFFICIENT_EVIDENCE, NO_EVIDENCE, UNSUPPORTED, INSUFFICIENT
  // Known model aliases for "evidence present" (map to PENDING, not a failure):
  //   EVIDENCE_PRESENT, SUFFICIENT_EVIDENCE, SUPPORTED, GROUNDED
  const rawStatus = String(obj.verifierStatus ?? obj.status ?? "")
    .trim()
    .toUpperCase();
  const INSUFFICIENT_ALIASES = new Set([
    "INSUFFICIENT_EVIDENCE",
    "NO_EVIDENCE",
    "UNSUPPORTED",
    "INSUFFICIENT",
    "NOT_SUPPORTED",
    "NO_SUPPORT"
  ]);
  const verifierStatus = INSUFFICIENT_ALIASES.has(rawStatus)
    ? "INSUFFICIENT_EVIDENCE"
    : "PENDING";

  return { type, stem, options, answer, rationale, citations, difficulty, tags, verifierStatus };
}

function repairNormalizedQuestionCitations(params: {
  normalizedQuestion: Record<string, unknown>;
  requestedType: "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE";
  chunks: RetrievalChunk[];
}): Record<string, unknown> {
  const rawCitations = Array.isArray(params.normalizedQuestion.citations)
    ? (params.normalizedQuestion.citations as NormalizedCitation[])
    : [];
  const chunksById = new Map(params.chunks.map((chunk) => [chunk.id, chunk]));
  const repairedCitations = rawCitations
    .map((citation) =>
      repairCitationAgainstChunks({
        citation,
        chunksById,
        requestedType: params.requestedType
      })
    )
    .filter((citation): citation is NormalizedCitation => Boolean(citation));

  if (repairedCitations.length === 0) {
    throw new Error("Citation excerpt does not match the cited evidence");
  }

  return {
    ...params.normalizedQuestion,
    citations: repairedCitations
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function generateQuestion(params: {
  styleProfile: unknown;
  difficulty: number;
  questionType?: "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE";
  chunks: RetrievalChunk[];
  retryContext?:
    | {
        strategy: "default" | "narrow_source_specific";
        previousFailureReason?: string | null;
      }
    | undefined;
  userId?: string | null;
  documentId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<GeneratedQuestion> {
  const promptPath = path.join(process.cwd(), "lib", "llm", "prompts", "question-generation.md");
  const system = await fs.readFile(promptPath, "utf8");

  const chunksBlock = params.chunks
    .map((chunk) => `Chunk ${chunk.id} (page ${chunk.page ?? "n/a"}): ${truncate(chunk.content)}`)
    .join("\n\n");

  const requestedType = params.questionType ?? "MCQ";
  const difficultyDescriptor = getDifficultyDescriptor(params.styleProfile, params.difficulty);
  const explicitStyleDirectives = getExplicitStyleDirectives(params.styleProfile);
  const assumedBackgroundLevel = getAssumedBackgroundLevel(params.styleProfile);
  const highRigorRequested = styleRequestsHighRigor(params.styleProfile);

  const user = [
    `Question type: ${requestedType}`,
    `Difficulty: ${params.difficulty}${difficultyDescriptor ? ` (${difficultyDescriptor})` : ""}`,
    buildOutsiderTestContext(params.styleProfile),
    buildOverviewAvoidanceGuidance({ requestedType, styleProfile: params.styleProfile }),
    highRigorRequested
      ? "High-rigor style requested: yes — prefer applied, discriminative, reasoning-based questions when supported."
      : null,
    buildHighRigorGuidance(requestedType, params.styleProfile)
      ? `Exam-discriminative guidance:\n${buildHighRigorGuidance(requestedType, params.styleProfile)}`
      : null,
    buildRetryGuidance({ retryContext: params.retryContext, requestedType, chunks: params.chunks }),
    explicitStyleDirectives ? `Explicit style directives:\n${explicitStyleDirectives}` : null,
    `Style profile JSON:\n${JSON.stringify(params.styleProfile)}`,
    `\nExcerpts:\n${chunksBlock}`
  ]
    .filter(Boolean)
    .join("\n\n");

  // Use chat completions with json_object directly — the structured output
  // endpoint's strict mode always rejects schemas with optional fields, so we
  // skip it and normalise the raw model output ourselves.
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
    feature: "question_generation",
    response,
    mode: "chat",
    userId: params.userId ?? null,
    documentId: params.documentId ?? null,
    metadata: {
      difficulty: params.difficulty,
      questionType: requestedType,
      chunkCount: params.chunks.length,
      assumedBackgroundLevel,
      hasStyleProfile: Boolean(params.styleProfile && Object.keys(params.styleProfile as object).length > 0),
      ...(params.metadata ?? {})
    },
    modelOverride: MODEL
  });

  const rawText = response.choices[0]?.message?.content ?? "";
  if (!rawText) {
    throw new Error("Model returned empty content");
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawText);
  } catch {
    throw new Error("Model returned non-JSON content");
  }

  // Normalise raw output → canonical shape
  let normalized: Record<string, unknown>;
  try {
    normalized = normalizeRawQuestion(rawJson, requestedType, params.difficulty);
  } catch (normError) {
    logger.warn(
      {
        requestedType,
        rawTopLevelKeys:
          rawJson !== null && typeof rawJson === "object" && !Array.isArray(rawJson)
            ? Object.keys(rawJson as object)
            : null,
        rawPreview: rawText.slice(0, 600),
        error: normError instanceof Error ? normError.message : String(normError)
      },
      "Failed to normalise raw LLM question output"
    );
    throw normError;
  }

  try {
    normalized = repairNormalizedQuestionCitations({
      normalizedQuestion: normalized,
      requestedType,
      chunks: params.chunks
    });
  } catch (citationError) {
    logger.warn(
      {
        requestedType,
        normalizedKeys: Object.keys(normalized),
        error: citationError instanceof Error ? citationError.message : String(citationError),
        rawPreview: rawText.slice(0, 600)
      },
      "Failed to align generated citation excerpts with source chunks"
    );
    throw citationError;
  }

  // Final schema validation — after normalisation fields should be present and typed correctly
  const parsed = GeneratedQuestionSchema.safeParse(normalized);
  if (!parsed.success) {
    logger.warn(
      {
        requestedType,
        normalizedKeys: Object.keys(normalized),
        validationErrors: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message
        })),
        rawPreview: rawText.slice(0, 600)
      },
      "Normalised question failed schema validation"
    );
    throw new Error(
      `Validation failed after normalisation: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    );
  }

  return parsed.data;
}
