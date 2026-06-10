export type GenerationOutcome =
  | "PENDING"
  | "PROCESSING"
  | "FAILED_NONE"
  | "COMPLETED_PARTIAL"
  | "COMPLETED_FULL";

export function getGenerationFailedCount(params: {
  requestedCount: number;
  passedCount: number;
}): number {
  return Math.max(0, params.requestedCount - params.passedCount);
}

export function getGenerationOutcome(params: {
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  requestedCount: number;
  passedCount: number;
}): GenerationOutcome {
  if (params.status === "PENDING" || params.status === "PROCESSING") {
    return params.status;
  }

  if (params.passedCount <= 0) {
    return "FAILED_NONE";
  }

  return params.passedCount >= params.requestedCount
    ? "COMPLETED_FULL"
    : "COMPLETED_PARTIAL";
}

export function buildGenerationSummary(params: {
  requestedCount: number;
  passedCount: number;
}): string {
  const failedCount = getGenerationFailedCount(params);

  if (params.passedCount <= 0) {
    return "We couldn't generate supported questions from this material. Try a different document or fewer questions.";
  }

  if (failedCount > 0) {
    return `Generated ${params.passedCount} of ${params.requestedCount} questions. Some questions could not be generated from the available evidence.`;
  }

  const questionText = params.passedCount === 1 ? "question" : "questions";
  return `Generated ${params.passedCount} ${questionText}.`;
}

export function canPracticeGeneratedQuestions(params: { passedCount: number }): boolean {
  return params.passedCount > 0;
}
