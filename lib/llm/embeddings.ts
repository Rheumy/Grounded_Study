import { getOpenAIClient } from "@/lib/llm/openai";
import { type AiUsageFeature } from "@/lib/observability/ai-cost";
import { estimateAiCostUsd } from "@/lib/observability/ai-cost";
import { recordOpenAiUsageEvent } from "@/lib/observability/ai-usage";

export const EMBEDDING_MODEL = "text-embedding-3-small";

export type EmbeddingUsageSummary = {
  model: string;
  inputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number;
};

export async function embedTextWithUsage(input: string): Promise<{
  vector: number[];
  usage: EmbeddingUsageSummary;
}> {
  const client = getOpenAIClient();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input
  });

  const vector = response.data[0]?.embedding;
  if (!vector) {
    throw new Error("Embedding generation failed.");
  }

  const totalTokens = response.usage?.total_tokens ?? null;
  const inputTokens = response.usage?.prompt_tokens ?? totalTokens;

  return {
    vector,
    usage: {
      model: EMBEDDING_MODEL,
      inputTokens,
      totalTokens,
      estimatedCostUsd: estimateAiCostUsd({
        model: EMBEDDING_MODEL,
        inputTokens,
        outputTokens: 0
      })
    }
  };
}

export async function embedText(
  input: string,
  usageContext?: {
    feature: Extract<AiUsageFeature, "document_embedding" | "retrieval_query_embedding">;
    userId?: string | null;
    documentId?: string | null;
    questionId?: string | null;
    metadata?: Record<string, unknown> | null;
  }
): Promise<number[]> {
  const client = getOpenAIClient();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input
  });

  if (usageContext) {
    await recordOpenAiUsageEvent({
      feature: usageContext.feature,
      response,
      mode: "embedding",
      userId: usageContext.userId ?? null,
      documentId: usageContext.documentId ?? null,
      questionId: usageContext.questionId ?? null,
      metadata: usageContext.metadata ?? null,
      modelOverride: EMBEDDING_MODEL
    });
  }

  const vector = response.data[0]?.embedding;
  if (!vector) {
    throw new Error("Embedding generation failed.");
  }
  return vector;
}
