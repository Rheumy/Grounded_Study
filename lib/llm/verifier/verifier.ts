import fs from "fs/promises";
import path from "path";
import { VerifierSchema, type VerifierResult } from "@/lib/llm/schemas/verifier";
import { runStructured } from "@/lib/llm/structured";
import type { GeneratedQuestion } from "@/lib/llm/schemas/question";

const MODEL = "gpt-4o-mini";

export async function verifyQuestion(params: {
  question: GeneratedQuestion;
  chunks: { id: string; content: string; page: number | null }[];
}): Promise<VerifierResult> {
  const promptPath = path.join(process.cwd(), "lib", "llm", "prompts", "question-verifier.md");
  const system = await fs.readFile(promptPath, "utf8");

  const chunkMap = params.chunks
    .map((chunk) => `Chunk ${chunk.id} (page ${chunk.page ?? "n/a"}): ${chunk.content}`)
    .join("\n\n");

  const user = `Question JSON:\n${JSON.stringify(params.question)}\n\nExcerpts:\n${chunkMap}`;

  return runStructured({
    model: MODEL,
    system,
    user,
    schemaName: "question_verifier",
    schema: VerifierSchema
  });
}
