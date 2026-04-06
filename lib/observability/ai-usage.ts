import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { estimateAiCostUsd, hasKnownModelPricing, type AiUsageFeature } from "@/lib/observability/ai-cost";
import { logger } from "@/lib/observability/logger";

type UsageSnapshot = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

type OpenAiLikeResponse = {
  model?: string | null;
  usage?: {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_tokens?: number | null;
  } | null;
};

function cleanMetadata(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | null {
  if (!value) return null;

  const entries = Object.entries(value).filter(([, field]) => field !== undefined);
  if (entries.length === 0) return null;

  return Object.fromEntries(entries) as Prisma.InputJsonValue;
}

function toUsageSnapshot(response: OpenAiLikeResponse, mode: "chat" | "embedding"): UsageSnapshot {
  const usage = response.usage;

  if (!usage) {
    return { inputTokens: null, outputTokens: null, totalTokens: null };
  }

  const promptTokens = usage.prompt_tokens ?? null;
  const completionTokens = usage.completion_tokens ?? null;
  const totalTokens =
    usage.total_tokens ??
    (promptTokens !== null || completionTokens !== null
      ? (promptTokens ?? 0) + (completionTokens ?? 0)
      : null);

  if (mode === "embedding") {
    return {
      inputTokens: promptTokens ?? totalTokens,
      outputTokens: 0,
      totalTokens
    };
  }

  return {
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    totalTokens
  };
}

export async function recordAiUsageEvent(params: {
  feature: AiUsageFeature;
  provider: string;
  model: string;
  userId?: string | null;
  documentId?: string | null;
  questionId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  metadata?: Record<string, unknown> | null;
}) {
  const estimatedCostUsd = estimateAiCostUsd({
    model: params.model,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens
  });

  const metadata = cleanMetadata({
    ...(params.metadata ?? {}),
    pricingKnown: hasKnownModelPricing(params.model)
  });

  try {
    await prisma.aiUsageEvent.create({
      data: {
        feature: params.feature,
        provider: params.provider,
        model: params.model,
        userId: params.userId ?? null,
        documentId: params.documentId ?? null,
        questionId: params.questionId ?? null,
        inputTokens: params.inputTokens ?? null,
        outputTokens: params.outputTokens ?? null,
        totalTokens: params.totalTokens ?? null,
        estimatedCostUsd: new Prisma.Decimal(estimatedCostUsd),
        metadataJson: metadata ?? Prisma.JsonNull
      }
    });
  } catch (error) {
    logger.warn(
      {
        feature: params.feature,
        model: params.model,
        userId: params.userId ?? null,
        documentId: params.documentId ?? null,
        questionId: params.questionId ?? null,
        error: error instanceof Error ? error.message : String(error)
      },
      "Failed to persist AI usage event"
    );
  }
}

export async function recordOpenAiUsageEvent(params: {
  feature: AiUsageFeature;
  response: OpenAiLikeResponse;
  mode: "chat" | "embedding";
  userId?: string | null;
  documentId?: string | null;
  questionId?: string | null;
  metadata?: Record<string, unknown> | null;
  modelOverride?: string | null;
}) {
  const usage = toUsageSnapshot(params.response, params.mode);
  const model = params.modelOverride ?? params.response.model ?? "unknown";

  await recordAiUsageEvent({
    feature: params.feature,
    provider: "openai",
    model,
    userId: params.userId ?? null,
    documentId: params.documentId ?? null,
    questionId: params.questionId ?? null,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    metadata: params.metadata ?? null
  });
}
