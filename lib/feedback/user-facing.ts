type QuestionType = "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE";

type CitationRecord = {
  chunkId: string;
  excerpt: string;
  page: number | null;
  section: string | null;
};

export type FeedbackCitation = {
  label: string;
  excerpt: string;
};

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function sanitizeFeedbackText(value: string | null | undefined): string {
  return collapseWhitespace(
    String(value ?? "")
      .replace(/\bChunk\s+[A-Za-z0-9_-]+(?:\s*\(page\s*[^)]*\))?:?\s*/gi, "")
      .replace(/\bchunkId\s*[:=]\s*[A-Za-z0-9_-]+\b/gi, "")
      .replace(/\bExcerpts?:\s*/gi, "")
  );
}

export function normalizeCitationRecords(input: unknown): CitationRecord[] {
  if (!Array.isArray(input)) return [];

  return input.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];

    const citation = item as Record<string, unknown>;
    const excerpt = sanitizeFeedbackText(
      typeof citation.excerpt === "string" ? citation.excerpt : ""
    );

    if (!excerpt) return [];

    return [
      {
        chunkId: typeof citation.chunkId === "string" ? citation.chunkId : "",
        excerpt,
        page: typeof citation.page === "number" ? citation.page : null,
        section:
          typeof citation.section === "string"
            ? sanitizeFeedbackText(citation.section)
            : typeof citation.heading === "string"
              ? sanitizeFeedbackText(citation.heading)
              : typeof citation.title === "string"
                ? sanitizeFeedbackText(citation.title)
                : null
      }
    ];
  });
}

export function formatFeedbackCitations(input: unknown): FeedbackCitation[] {
  return normalizeCitationRecords(input).map((citation, index) => ({
    label:
      citation.section && citation.page !== null
        ? `${citation.section} · Page ${citation.page}`
        : citation.section
          ? citation.section
          : citation.page !== null
            ? `Page ${citation.page}`
            : `Source ${index + 1}`,
    excerpt: citation.excerpt
  }));
}

function toUserFacingGraderReason(value: string | null | undefined): string {
  const reason = sanitizeFeedbackText(value);
  const normalized = reason.toLowerCase();

  if (
    !reason ||
    normalized === "could not parse grading response" ||
    normalized === "grader returned empty response" ||
    normalized === "grader returned non-json response"
  ) {
    return "The answer could not be graded confidently from the available evidence.";
  }

  return reason;
}

export function buildUserFacingRationale(params: {
  questionType: QuestionType;
  storedRationale: string;
  graderReason?: string | null;
  correct: boolean;
  needsReview: boolean;
}): string {
  const baseRationale = sanitizeFeedbackText(params.storedRationale);

  if (params.questionType !== "SHORT_ANSWER") {
    return (
      baseRationale ||
      (params.correct
        ? "This answer is supported by the source material."
        : "The correct answer is the one best supported by the source material.")
    );
  }

  const graderReason = toUserFacingGraderReason(params.graderReason);

  if (baseRationale && graderReason && baseRationale.toLowerCase() !== graderReason.toLowerCase()) {
    return `${graderReason} ${baseRationale}`.trim();
  }

  return (
    graderReason ||
    baseRationale ||
    (params.needsReview
      ? "This answer needs review against the source material."
      : params.correct
        ? "This answer matches the expected response."
        : "This answer does not match the expected response.")
  );
}
