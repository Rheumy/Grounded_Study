export const ALL_QUESTION_TYPES = ["MCQ", "SHORT_ANSWER", "TRUE_FALSE"] as const;
export const VISIBLE_QUESTION_TYPES = ["MCQ", "TRUE_FALSE"] as const;

export type QuestionType = (typeof ALL_QUESTION_TYPES)[number];
export type VisibleQuestionType = (typeof VISIBLE_QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  MCQ: "Multiple choice",
  SHORT_ANSWER: "Short answer",
  TRUE_FALSE: "True/false"
};

export function isVisibleQuestionType(value: string): value is VisibleQuestionType {
  return VISIBLE_QUESTION_TYPES.includes(value as VisibleQuestionType);
}

export function normalizeQuestionType(value: unknown): QuestionType | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase().replace(/[-\s/]+/g, "_");

  if (normalized === "MULTIPLE_CHOICE" || normalized === "MULTIPLE_CHOICE_QUESTION") {
    return "MCQ";
  }

  if (
    normalized === "SHORTANSWER" ||
    normalized === "SHORT_ANSWER_QUESTION" ||
    normalized === "OPEN_ENDED"
  ) {
    return "SHORT_ANSWER";
  }

  if (
    normalized === "TRUEFALSE" ||
    normalized === "TRUE_FALSE_QUESTION" ||
    normalized === "T_F" ||
    normalized === "TF"
  ) {
    return "TRUE_FALSE";
  }

  return ALL_QUESTION_TYPES.includes(normalized as QuestionType)
    ? (normalized as QuestionType)
    : null;
}
