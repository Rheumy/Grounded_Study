import { getOpenAIClient } from "@/lib/llm/openai";

const EMBEDDING_MODEL = "text-embedding-3-small";

export async function embedText(input: string): Promise<number[]> {
  const client = getOpenAIClient();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input
  });
  const vector = response.data[0]?.embedding;
  if (!vector) {
    throw new Error("Embedding generation failed.");
  }
  return vector;
}
