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

