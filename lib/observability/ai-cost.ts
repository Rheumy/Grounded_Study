export type AiUsageFeature =
  | "style_profile_extraction"
  | "question_generation"
  | "question_verification"
  | "short_answer_grading"
  | "document_embedding"
  | "retrieval_query_embedding"
  | "ocr";

type ChatModelPricing = {
  kind: "chat";
  inputPerMillion: number;
  outputPerMillion: number;
};

type EmbeddingModelPricing = {
  kind: "embedding";
  inputPerMillion: number;
};

type ModelPricing = ChatModelPricing | EmbeddingModelPricing;

const MODEL_PRICING_USD_PER_MILLION: Record<string, ModelPricing> = {
  "gpt-4o-mini": {
    kind: "chat",
    inputPerMillion: 0.15,
    outputPerMillion: 0.6
  },
  "text-embedding-3-small": {
    kind: "embedding",
    inputPerMillion: 0.02
  }
};

function findPricing(model: string): ModelPricing | null {
  const exact = MODEL_PRICING_USD_PER_MILLION[model];
  if (exact) return exact;

  const prefixMatch = Object.entries(MODEL_PRICING_USD_PER_MILLION).find(([key]) =>
    model.startsWith(key)
  );

  return prefixMatch?.[1] ?? null;
}

export function estimateAiCostUsd(params: {
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
}): number {
  const pricing = findPricing(params.model);
  if (!pricing) return 0;

  const inputTokens = Math.max(0, params.inputTokens ?? 0);
  const outputTokens = Math.max(0, params.outputTokens ?? 0);

  if (pricing.kind === "embedding") {
    return (inputTokens * pricing.inputPerMillion) / 1_000_000;
  }

  return (
    (inputTokens * pricing.inputPerMillion) / 1_000_000 +
    (outputTokens * pricing.outputPerMillion) / 1_000_000
  );
}

export function hasKnownModelPricing(model: string): boolean {
  return findPricing(model) !== null;
}
