import type { StyleProfile } from "@/lib/llm/schemas/style-profile";

export type PresetKey =
  | "standard_mcq"
  | "standard_true_false"
  | "standard_short_answer";

export type QuestionStylePreset = {
  key: PresetKey;
  label: string;
  description: string;
  styleProfile: StyleProfile;
  starterGuidance: string;
};

export const DEFAULT_QUESTION_STYLE_PRESET_KEY: PresetKey = "standard_mcq";

export const DEFAULT_DIFFICULTY_MAP: StyleProfile["difficultyMap"] = {
  "1": "recall and recognition",
  "2": "comprehension and paraphrase",
  "3": "application and analysis",
  "4": "synthesis and evaluation",
  "5": "expert edge cases and distinctions"
};

export const PRESET_STANDARD_MCQ: QuestionStylePreset = {
  key: "standard_mcq",
  label: "Standard MCQ",
  description:
    "Standard multiple-choice questions with 4 options, one correct. Neutral academic tone. Works across most exam contexts.",
  styleProfile: {
    questionTypeDistribution: { MCQ: 1, SHORT_ANSWER: 0, TRUE_FALSE: 0 },
    stemLength: { minWords: 12, maxWords: 35 },
    distractorStyle: "plausible near-misses from the same conceptual family",
    explanationTone: "clear and direct",
    answerStyle: "single correct option with brief rationale",
    difficultyMap: DEFAULT_DIFFICULTY_MAP,
    assumedBackgroundLevel: "generalist",
    notes: "Standard universal MCQ preset"
  },
  starterGuidance: [
    "Start from the Standard MCQ preset.",
    "Question type distribution: MCQ only.",
    "Stem length: 12 to 35 words.",
    "Distractor style: plausible near-misses from the same conceptual family.",
    "Explanation tone: clear and direct.",
    "Answer style: single correct option with brief rationale.",
    "Assumed background level: generalist.",
    "Notes: Standard universal MCQ preset.",
    "Customize from here if you want a different exam tone, level, or subject emphasis."
  ].join("\n")
};

export const PRESET_STANDARD_TRUE_FALSE: QuestionStylePreset = {
  key: "standard_true_false",
  label: "Standard True/False",
  description:
    "True/false statements testing clear grounded distinctions. Balanced between true and false propositions.",
  styleProfile: {
    questionTypeDistribution: { MCQ: 0, SHORT_ANSWER: 0, TRUE_FALSE: 1 },
    stemLength: { minWords: 10, maxWords: 30 },
    distractorStyle: "n/a",
    explanationTone: "clear and direct",
    answerStyle: "True or False with grounded rationale",
    difficultyMap: DEFAULT_DIFFICULTY_MAP,
    assumedBackgroundLevel: "generalist",
    notes: "Standard universal True/False preset"
  },
  starterGuidance: [
    "Start from the Standard True/False preset.",
    "Question type distribution: True/False only.",
    "Stem length: 10 to 30 words.",
    "Explanation tone: clear and direct.",
    "Answer style: True or False with grounded rationale.",
    "Assumed background level: generalist.",
    "Notes: Standard universal True/False preset with balanced true and false propositions.",
    "Customize from here if you want a different exam tone, level, or subject emphasis."
  ].join("\n")
};

export const PRESET_STANDARD_SHORT_ANSWER: QuestionStylePreset = {
  key: "standard_short_answer",
  label: "Standard Short Answer",
  description:
    "Open-ended questions with one to two sentence model answers. Direct and concise.",
  styleProfile: {
    questionTypeDistribution: { MCQ: 0, SHORT_ANSWER: 1, TRUE_FALSE: 0 },
    stemLength: { minWords: 10, maxWords: 30 },
    distractorStyle: "n/a",
    explanationTone: "clear and direct",
    answerStyle: "one to two complete sentences",
    difficultyMap: DEFAULT_DIFFICULTY_MAP,
    assumedBackgroundLevel: "generalist",
    notes: "Standard universal Short Answer preset"
  },
  starterGuidance: [
    "Start from the Standard Short Answer preset.",
    "Question type distribution: Short Answer only.",
    "Stem length: 10 to 30 words.",
    "Explanation tone: clear and direct.",
    "Answer style: one to two complete sentences.",
    "Assumed background level: generalist.",
    "Notes: Standard universal Short Answer preset.",
    "Customize from here if you want a different exam tone, level, or subject emphasis."
  ].join("\n")
};

export const PRESETS: Record<PresetKey, QuestionStylePreset> = {
  standard_mcq: PRESET_STANDARD_MCQ,
  standard_true_false: PRESET_STANDARD_TRUE_FALSE,
  standard_short_answer: PRESET_STANDARD_SHORT_ANSWER
};

export const PRESET_DISPLAY_ORDER: PresetKey[] = [
  "standard_mcq",
  "standard_true_false",
  "standard_short_answer"
];

export const PRESETS_IN_DISPLAY_ORDER = PRESET_DISPLAY_ORDER.map((key) => PRESETS[key]);

export function resolvePreset(presetKey: string | null | undefined): QuestionStylePreset | null {
  if (!presetKey) {
    return null;
  }

  return PRESETS[presetKey as PresetKey] ?? null;
}
