const HIDDEN_QUESTION_IDS_KEY = "grounded-study:hidden-question-ids";
const SUPPRESS_HIDE_WARNING_KEY = "grounded-study:suppress-hide-question-warning";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadHiddenQuestionIds(): string[] {
  if (!canUseStorage()) return [];

  try {
    const raw = window.localStorage.getItem(HIDDEN_QUESTION_IDS_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  } catch {
    return [];
  }
}

export function persistHiddenQuestionIds(questionIds: string[]) {
  if (!canUseStorage()) return;

  try {
    window.localStorage.setItem(
      HIDDEN_QUESTION_IDS_KEY,
      JSON.stringify(Array.from(new Set(questionIds)).slice(-1000))
    );
  } catch {
    // Ignore storage failures and fall back to the current in-memory session.
  }
}

export function loadSuppressHideWarningPreference(): boolean {
  if (!canUseStorage()) return false;

  try {
    return window.localStorage.getItem(SUPPRESS_HIDE_WARNING_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistSuppressHideWarningPreference(value: boolean) {
  if (!canUseStorage()) return;

  try {
    if (value) {
      window.localStorage.setItem(SUPPRESS_HIDE_WARNING_KEY, "1");
    } else {
      window.localStorage.removeItem(SUPPRESS_HIDE_WARNING_KEY);
    }
  } catch {
    // Ignore storage failures.
  }
}
