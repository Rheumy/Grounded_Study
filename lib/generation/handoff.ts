export const GENERATION_HANDOFF_STORAGE_PREFIX = "grounded-study:generation-handoff:v1:";

export type GenerationHandoffInput = {
  documentIds: string[];
  questionMix: string | null;
  count: number;
  difficulty: number;
};

type StoredGenerationHandoff = {
  jobId: string;
  storedAt: string;
};

export function buildGenerationHandoffKey(input: GenerationHandoffInput): string {
  const normalized = {
    documentIds: [...new Set(input.documentIds)].sort(),
    questionMix: input.questionMix ?? "MCQ",
    count: input.count,
    difficulty: input.difficulty
  };

  return `${GENERATION_HANDOFF_STORAGE_PREFIX}${JSON.stringify(normalized)}`;
}

export function readGenerationHandoffJobId(
  storage: Pick<Storage, "getItem">,
  key: string
): string | null {
  const raw = storage.getItem(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredGenerationHandoff>;
    return typeof parsed.jobId === "string" && parsed.jobId ? parsed.jobId : null;
  } catch {
    return null;
  }
}

export function writeGenerationHandoffJobId(
  storage: Pick<Storage, "setItem">,
  key: string,
  jobId: string
) {
  storage.setItem(
    key,
    JSON.stringify({
      jobId,
      storedAt: new Date().toISOString()
    } satisfies StoredGenerationHandoff)
  );
}
