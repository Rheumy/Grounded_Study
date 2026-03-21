import fs from "fs/promises";
import path from "path";
import { getOpenAIClient } from "@/lib/llm/openai";
import { GeneratedQuestionSchema, type GeneratedQuestion } from "@/lib/llm/schemas/question";
import { logger } from "@/lib/observability/logger";

const MODEL = "gpt-4o-mini";

export type RetrievalChunk = {
  id: string;
  content: string;
  page: number | null;
};

function truncate(content: string, max = 800) {
  if (content.length <= max) return content;
  return `${content.slice(0, max)}...`;
}

// ---------------------------------------------------------------------------
// Option normalisation
// The model sometimes returns options as objects with a "text", "value", or
// "label" key instead of plain strings.
// ---------------------------------------------------------------------------
function extractOptionText(opt: unknown): string {
  if (typeof opt === "string") return opt;
  if (opt !== null && typeof opt === "object" && !Array.isArray(opt)) {
    const o = opt as Record<string, unknown>;
    const val = o.text ?? o.value ?? o.content ?? o.label ?? o.option ?? o.answer;
    if (val !== undefined) return String(val);
  }
  return String(opt ?? "");
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
  return {
    chunkId: String(obj.chunkId ?? obj.chunk_id ?? obj.id ?? obj.source ?? ""),
    excerpt: String(obj.excerpt ?? obj.quote ?? obj.text ?? obj.content ?? obj.passage ?? ""),
    page: obj.page != null ? Number(obj.page) : (obj.pageNumber != null ? Number(obj.pageNumber) : null)
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

  // Unwrap common single-key nesting patterns, e.g. { "question": {...} }
  // Only unwrap if the top level doesn't already look like a question itself.
  if (!obj.type && !obj.stem && !obj.question_text) {
    for (const wrapKey of ["question", "generated_question", "result", "output", "data"]) {
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
  const answer = String(obj.answer ?? obj.correct_answer ?? obj.correctAnswer ?? "").trim();

  // --- rationale ---
  const rationale = String(
    obj.rationale ?? obj.explanation ?? obj.reasoning ?? obj.justification ?? ""
  ).trim();

  // --- citations ---
  const rawCitations = obj.citations ?? obj.references ?? obj.sources ?? obj.evidence;
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
  // Honour INSUFFICIENT_EVIDENCE if the model explicitly signals it.
  // Default everything else to PENDING.
  const rawStatus = String(obj.verifierStatus ?? obj.status ?? "");
  const verifierStatus =
    rawStatus.toUpperCase() === "INSUFFICIENT_EVIDENCE"
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
}): Promise<GeneratedQuestion> {
  const promptPath = path.join(process.cwd(), "lib", "llm", "prompts", "question-generation.md");
  const system = await fs.readFile(promptPath, "utf8");

  const chunksBlock = params.chunks
    .map((chunk) => `Chunk ${chunk.id} (page ${chunk.page ?? "n/a"}): ${truncate(chunk.content)}`)
    .join("\n\n");

  const requestedType = params.questionType ?? "MCQ";

  const user = [
    `Style profile JSON:\n${JSON.stringify(params.styleProfile)}`,
    `Difficulty: ${params.difficulty}`,
    `Question type: ${requestedType}`,
    `\nExcerpts:\n${chunksBlock}`
  ].join("\n");

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
