import fs from "fs/promises";
import path from "path";
import { getOpenAIClient } from "@/lib/llm/openai";
import { GeneratedQuestionSchema, type GeneratedQuestion } from "@/lib/llm/schemas/question";
import { logger } from "@/lib/observability/logger";
import { recordOpenAiUsageEvent } from "@/lib/observability/ai-usage";

const MODEL = "gpt-4o-mini";

export type RetrievalChunk = {
  id: string;
  content: string;
  page: number | null;
};

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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

function styleRequestsHighRigor(styleProfile: unknown): boolean {
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
function normalizeCitation(c: unknown): Record<string, unknown> {
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function generateQuestion(params: {
  styleProfile: unknown;
  difficulty: number;
  questionType?: "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE";
  chunks: RetrievalChunk[];
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
  const highRigorRequested = styleRequestsHighRigor(params.styleProfile);

  const user = [
    `Question type: ${requestedType}`,
    `Difficulty: ${params.difficulty}${difficultyDescriptor ? ` (${difficultyDescriptor})` : ""}`,
    highRigorRequested
      ? "High-rigor style requested: yes — prefer applied, discriminative, reasoning-based questions when supported."
      : null,
    buildHighRigorGuidance(requestedType, params.styleProfile)
      ? `Exam-discriminative guidance:\n${buildHighRigorGuidance(requestedType, params.styleProfile)}`
      : null,
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
