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
    return "No questions could be generated from the available material. Try a smaller request or upload more specific study material.";
  }

  const questionText = params.passedCount === 1 ? "question generated" : "questions generated";
  if (failedCount > 0) {
    return `${params.passedCount} ${questionText} successfully. Some requested questions could not be generated from the available material.`;
  }

  return `${params.passedCount} ${questionText} successfully.`;
}

export function canPracticeGeneratedQuestions(params: { passedCount: number }): boolean {
  return params.passedCount > 0;
}
