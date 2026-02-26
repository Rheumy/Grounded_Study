import fs from "fs/promises";
import path from "path";
import { GeneratedQuestionSchema, type GeneratedQuestion } from "@/lib/llm/schemas/question";
import { runStructured } from "@/lib/llm/structured";

const MODEL = "gpt-4o-mini";

export type RetrievalChunk = {
  id: string;
  content: string;
  page: number | null;
};

function truncate(content: string, max = 800) {
  if (content.length <= max) return content;
  return `${content.slice(0, max)}...`;
}

export async function generateQuestion(params: {
  styleProfile: unknown;
  difficulty: number;
  questionType?: "MCQ" | "SHORT_ANSWER";
  chunks: RetrievalChunk[];
}): Promise<GeneratedQuestion> {
  const promptPath = path.join(process.cwd(), "lib", "llm", "prompts", "question-generation.md");
  const system = await fs.readFile(promptPath, "utf8");

  const chunksBlock = params.chunks
    .map(
      (chunk) =>
        `Chunk ${chunk.id} (page ${chunk.page ?? "n/a"}): ${truncate(chunk.content)}`
    )
    .join("\n\n");

  const user = `Style profile JSON:\n${JSON.stringify(params.styleProfile)}\n\nDifficulty: ${params.difficulty}\nQuestion type: ${params.questionType ?? "MCQ"}\n\nExcerpts:\n${chunksBlock}`;

  return runStructured({
    model: MODEL,
    system,
    user,
    schemaName: "generated_question",
    schema: GeneratedQuestionSchema
  });
}
