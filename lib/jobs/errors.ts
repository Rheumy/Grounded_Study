const GENERIC_GENERATION_ERROR = "Generation failed. Please try again.";

export function sanitizeGenerationErrorMessage(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error ?? "");
  const firstLine = rawMessage.trim().split(/\r?\n/)[0]?.trim() ?? "";

  if (!firstLine) {
    return GENERIC_GENERATION_ERROR;
  }

  const looksLikeSchemaDump =
    firstLine.includes("ZodError") ||
    (firstLine.includes('"code"') && firstLine.includes('"path"')) ||
    firstLine.startsWith("[") ||
    (firstLine.startsWith("{") && firstLine.includes("issues"));

  if (looksLikeSchemaDump) {
    return GENERIC_GENERATION_ERROR;
  }

  if (firstLine.length > 240) {
    return `${firstLine.slice(0, 237)}...`;
  }

  return firstLine;
}
