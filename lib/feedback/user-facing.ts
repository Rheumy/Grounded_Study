type QuestionType = "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE";

export type ShortAnswerReviewStatus = "STRONG_MATCH" | "PARTIAL_MATCH" | "NEEDS_REVIEW";

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
      .replace(/\baccording to the excerpts?,?\s*/gi, "")
      .replace(/\bbased on the excerpts?,?\s*/gi, "")
      .replace(/\bin the excerpts?,?\s*/gi, "")
      .replace(/\bthe excerpts? (?:mentions?|states?|indicates?|shows?|describes?|explains?|notes?) that\s*/gi, "")
      .replace(/\bthe excerpts? (?:mentions?|states?|indicates?|shows?|describes?|explains?|notes?)\s*/gi, "")
      .replace(/\bthe source material (?:mentions?|states?|indicates?|shows?|describes?|explains?|notes?) that\s*/gi, "")
      .replace(/\bthe source material (?:mentions?|states?|indicates?|shows?|describes?|explains?|notes?)\s*/gi, "")
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

export function getShortAnswerReviewStatus(params: {
  questionType: QuestionType;
  hasAnswer: boolean;
  correct: boolean;
  needsReview: boolean;
}): ShortAnswerReviewStatus | null {
  if (params.questionType !== "SHORT_ANSWER" || !params.hasAnswer) {
    return null;
  }

  if (params.needsReview) {
    return "NEEDS_REVIEW";
  }

  return params.correct ? "STRONG_MATCH" : "PARTIAL_MATCH";
}

export function getShortAnswerReviewLabel(
  status: ShortAnswerReviewStatus | null
): string | null {
  if (status === "STRONG_MATCH") return "Strong match";
  if (status === "PARTIAL_MATCH") return "Partial match";
  if (status === "NEEDS_REVIEW") return "Could not be confidently graded";
  return null;
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
        ? "This answer is correct."
        : "The model answer is the best match here.")
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
      ? "This answer needs review."
      : params.correct
        ? "This answer matches the expected response."
        : "This answer does not match the expected response.")
  );
}
