export type ObjectiveQuestionType = "MCQ" | "TRUE_FALSE";

export function normalizeObjectiveAnswerForCompare(
  value: string | null | undefined,
  questionType: ObjectiveQuestionType
): string {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();

  if (questionType === "TRUE_FALSE") {
    const lower = normalized.toLowerCase();
    if (lower === "true" || lower === "t") return "true";
    if (lower === "false" || lower === "f") return "false";
  }

  return normalized.toLowerCase();
}

export function objectiveAnswersMatch(params: {
  selectedAnswer: string | null | undefined;
  storedAnswer: string | null | undefined;
  questionType: ObjectiveQuestionType;
}): boolean {
  return (
    normalizeObjectiveAnswerForCompare(params.selectedAnswer, params.questionType) ===
    normalizeObjectiveAnswerForCompare(params.storedAnswer, params.questionType)
  );
}
