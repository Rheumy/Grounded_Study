import fs from "fs/promises";
import path from "path";
import { getOpenAIClient } from "@/lib/llm/openai";
import { StyleProfileSchema, type StyleProfile } from "@/lib/llm/schemas/style-profile";
import { logger } from "@/lib/observability/logger";

const MODEL = "gpt-4o-mini";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toStr(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v.trim();
  if (v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v)) {
    // Flatten object to a readable string
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k}: ${String(val ?? "")}`)
      .join("; ")
      .trim();
  }
  if (Array.isArray(v)) return v.map((x) => String(x ?? "")).join(", ").trim();
  if (v !== null && v !== undefined) return String(v).trim();
  return fallback;
}

function toNum(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------------------
// Normalise questionTypeDistribution
// The model may return:
//   - percentage integers (80 instead of 0.8)
//   - missing TRUE_FALSE key
//   - non-numeric values
// ---------------------------------------------------------------------------
function normalizeDistribution(
  raw: unknown
): { MCQ: number; SHORT_ANSWER: number; TRUE_FALSE: number } {
  const defaults = { MCQ: 0.7, SHORT_ANSWER: 0.3, TRUE_FALSE: 0.0 };

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;

  const obj = raw as Record<string, unknown>;

  // Accept common key aliases
  const mcqRaw =
    obj.MCQ ?? obj.mcq ?? obj.multiple_choice ?? obj.multipleChoice ?? obj.MULTIPLE_CHOICE;
  const saRaw =
    obj.SHORT_ANSWER ??
    obj.short_answer ??
    obj.shortAnswer ??
    obj.SHORT_ANSWER_QUESTION ??
    obj.open_ended ??
    obj.openEnded;
  const tfRaw =
    obj.TRUE_FALSE ??
    obj.true_false ??
    obj.trueFalse ??
    obj.truefalse ??
    obj.TF ??
    obj.tf;

  let mcq = toNum(mcqRaw, defaults.MCQ);
  let sa = toNum(saRaw, defaults.SHORT_ANSWER);
  let tf = toNum(tfRaw, defaults.TRUE_FALSE);

  // If any value > 1, assume the model used percentages (0–100) → convert
  if (mcq > 1 || sa > 1 || tf > 1) {
    mcq = mcq / 100;
    sa = sa / 100;
    tf = tf / 100;
  }

  // Clamp all to [0, 1]
  mcq = Math.max(0, Math.min(1, mcq));
  sa = Math.max(0, Math.min(1, sa));
  tf = Math.max(0, Math.min(1, tf));

  return { MCQ: mcq, SHORT_ANSWER: sa, TRUE_FALSE: tf };
}

// ---------------------------------------------------------------------------
// Normalise stemLength
// The model may omit this field or use min/max instead of minWords/maxWords.
// ---------------------------------------------------------------------------
function normalizeStemLength(raw: unknown): { minWords: number; maxWords: number } {
  const defaults = { minWords: 8, maxWords: 30 };

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;

  const obj = raw as Record<string, unknown>;

  const minRaw = obj.minWords ?? obj.min_words ?? obj.min ?? obj.minimum ?? obj.minWord;
  const maxRaw = obj.maxWords ?? obj.max_words ?? obj.max ?? obj.maximum ?? obj.maxWord;

  const minWords = Math.max(3, Math.round(toNum(minRaw, defaults.minWords)));
  const maxWords = Math.max(5, Math.round(toNum(maxRaw, defaults.maxWords)));

  return { minWords, maxWords: Math.max(minWords + 2, maxWords) };
}

// ---------------------------------------------------------------------------
// Normalise difficultyMap
// Keys may be numbers instead of strings; values may be missing.
// ---------------------------------------------------------------------------
function normalizeDifficultyMap(raw: unknown): Record<string, string> {
  const defaults: Record<string, string> = {
    "1": "recall and recognition",
    "2": "comprehension and paraphrase",
    "3": "application and analysis",
    "4": "synthesis and evaluation",
    "5": "expert edge cases and distinctions"
  };

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;

  const obj = raw as Record<string, unknown>;
  const result: Record<string, string> = { ...defaults };

  for (const level of ["1", "2", "3", "4", "5"] as const) {
    const v = obj[level] ?? obj[Number(level)];
    if (v !== undefined) result[level] = toStr(v, defaults[level]);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Normalise preferredTags
// ---------------------------------------------------------------------------
function normalizeTags(raw: unknown): string[] | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw)) {
    const tags = raw.map((x) => toStr(x)).filter(Boolean);
    return tags.length > 0 ? tags : undefined;
  }
  if (typeof raw === "string") {
    const tags = raw
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return tags.length > 0 ? tags : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Full raw → canonical normalisation for StyleProfile
// ---------------------------------------------------------------------------
function normalizeRawStyleProfile(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Unexpected style profile shape from model: ${typeof raw}`);
  }

  let obj = raw as Record<string, unknown>;

  // Unwrap common nesting: { profile: { ... } } or { style_profile: { ... } }
  if (!obj.questionTypeDistribution && !obj.distractorStyle && !obj.stemLength) {
    for (const wrapKey of ["profile", "style_profile", "result", "data", "output"]) {
      const candidate = obj[wrapKey];
      if (candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)) {
        obj = candidate as Record<string, unknown>;
        break;
      }
    }
  }

  const questionTypeDistribution = normalizeDistribution(obj.questionTypeDistribution);
  const stemLength = normalizeStemLength(obj.stemLength);

  const distractorStyle =
    toStr(obj.distractorStyle ?? obj.distractor_style ?? obj.distractor, "") ||
    "plausible near-misses";

  const explanationTone =
    toStr(obj.explanationTone ?? obj.explanation_tone ?? obj.tone ?? obj.explanationStyle, "") ||
    "clear and direct";

  const answerStyle =
    toStr(obj.answerStyle ?? obj.answer_style ?? obj.answerFormat ?? obj.shortAnswerStyle, "") ||
    undefined;

  const difficultyMap = normalizeDifficultyMap(
    obj.difficultyMap ?? obj.difficulty_map ?? obj.difficulty
  );

  const preferredTags = normalizeTags(
    obj.preferredTags ?? obj.preferred_tags ?? obj.tags ?? obj.topics
  );

  // notes: flatten objects or arrays to a string
  const rawNotes = obj.notes ?? obj.note ?? obj.observations ?? obj.remarks;
  const notes = rawNotes !== undefined ? toStr(rawNotes) || undefined : undefined;

  return {
    questionTypeDistribution,
    stemLength,
    distractorStyle,
    explanationTone,
    ...(answerStyle ? { answerStyle } : {}),
    difficultyMap,
    ...(preferredTags ? { preferredTags } : {}),
    ...(notes ? { notes } : {})
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function extractStyleProfile(params: {
  name: string;
  examplesText?: string | null;
  examplesImagesText?: string | null;
  sampleFilesText?: string | null;
  instructionsText?: string | null;
}): Promise<StyleProfile> {
  const promptPath = path.join(process.cwd(), "lib", "llm", "prompts", "style-profile.md");
  const system = await fs.readFile(promptPath, "utf8");

  const sections = [
    `Style profile name: ${params.name}`,
    `\nPasted sample questions / model answers / marking guides:\n${params.examplesText ?? "(none)"}`,
    `\nExtracted text from uploaded sample files (PDF/images):\n${
      [params.sampleFilesText, params.examplesImagesText].filter(Boolean).join("\n\n---\n\n") ||
      "(none)"
    }`,
    `\nFree-text instructions from user:\n${params.instructionsText ?? "(none)"}`
  ];

  const user = sections.join("\n");

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
    throw new Error("Model returned empty response for style profile extraction");
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawText);
  } catch {
    throw new Error("Model returned non-JSON content for style profile extraction");
  }

  let normalized: Record<string, unknown>;
  try {
    normalized = normalizeRawStyleProfile(rawJson);
  } catch (normError) {
    logger.warn(
      {
        rawTopLevelKeys:
          rawJson !== null && typeof rawJson === "object" && !Array.isArray(rawJson)
            ? Object.keys(rawJson as object)
            : null,
        rawPreview: rawText.slice(0, 600),
        error: normError instanceof Error ? normError.message : String(normError)
      },
      "Failed to normalise raw style profile output"
    );
    throw normError;
  }

  const parsed = StyleProfileSchema.safeParse(normalized);
  if (!parsed.success) {
    logger.warn(
      {
        normalizedKeys: Object.keys(normalized),
        validationErrors: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message
        })),
        rawPreview: rawText.slice(0, 600)
      },
      "Normalised style profile failed schema validation"
    );
    throw new Error(
      `Style profile validation failed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    );
  }

  return parsed.data;
}
