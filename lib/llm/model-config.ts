export const DEFAULT_OPENAI_CHAT_MODEL = "gpt-4o-mini";
export const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";

function readModelEnv(name: string, fallback: string) {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

export function getQuestionGenerationModel() {
  return readModelEnv("OPENAI_QUESTION_GENERATION_MODEL", DEFAULT_OPENAI_CHAT_MODEL);
}

export function getQuestionVerifierModel() {
  return readModelEnv("OPENAI_QUESTION_VERIFIER_MODEL", DEFAULT_OPENAI_CHAT_MODEL);
}

export function getStyleProfileModel() {
  return readModelEnv("OPENAI_STYLE_PROFILE_MODEL", DEFAULT_OPENAI_CHAT_MODEL);
}

export function getShortAnswerGraderModel() {
  return readModelEnv("OPENAI_SHORT_ANSWER_GRADER_MODEL", DEFAULT_OPENAI_CHAT_MODEL);
}
