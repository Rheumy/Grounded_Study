import type { GeneratedQuestion } from "@/lib/llm/schemas/question";

const UNIVERSAL_ABBREVIATIONS = new Set([
  "AI",
  "ATP",
  "CT",
  "DNA",
  "ECG",
  "EEG",
  "EMG",
  "HIV",
  "IL",
  "MRI",
  "PCR",
  "PAM",
  "CRISPR",
  "TCA",
  "RNA",
  "UK",
  "US",
  "USA"
]);

function questionText(question: GeneratedQuestion): string {
  return [
    question.stem,
    ...(question.options ?? []),
    question.answer,
    question.rationale
  ].join(" ");
}

function uniqueAcronyms(value: string): string[] {
  const matches = value.match(/\b[A-Z][A-Z0-9]{1,7}\b/g) ?? [];
  return Array.from(new Set(matches));
}

function hasInlineExpansion(text: string, acronym: string): boolean {
  const escaped = acronym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const longFormBefore = new RegExp(`\\b[A-Za-z][A-Za-z -]{2,}\\s*\\(${escaped}\\)`);
  const longFormAfter = new RegExp(`\\b${escaped}\\s*\\([A-Za-z][A-Za-z -]{2,}\\)`);
  return longFormBefore.test(text) || longFormAfter.test(text);
}

function isAbbreviationItselfTested(text: string, acronym: string): boolean {
  const escaped = acronym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(abbreviation|acronym|stands for).{0,48}\\b${escaped}\\b|\\b${escaped}\\b.{0,48}(abbreviation|acronym|stands for)`,
    "i"
  ).test(text);
}

export function findUnexplainedAbbreviations(question: GeneratedQuestion): string[] {
  const text = questionText(question);
  return uniqueAcronyms(text).filter(
    (acronym) =>
      !UNIVERSAL_ABBREVIATIONS.has(acronym) &&
      !hasInlineExpansion(text, acronym) &&
      !isAbbreviationItselfTested(text, acronym)
  );
}

export function findAwkwardStemReason(stem: string): string | null {
  const normalized = stem.replace(/\s+/g, " ").trim().toLowerCase();

  if (
    /which of the following differentiates\b/.test(normalized) &&
    /\bcompared to\b|\bcompared with\b/.test(normalized)
  ) {
    return "Stem uses convoluted differentiates/compared-to wording instead of a direct exam-style question";
  }

  if (/which of the following differentiates\b/.test(normalized) && normalized.split(" ").length > 16) {
    return "Stem is hard to parse and should be rewritten as a direct exam-style question";
  }

  return null;
}
