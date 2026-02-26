import fs from "fs/promises";
import path from "path";
import { runStructured } from "@/lib/llm/structured";
import { ShortAnswerGradeSchema, type ShortAnswerGrade } from "@/lib/llm/schemas/grading";

const MODEL = "gpt-4o-mini";

export async function gradeShortAnswer(params: {
  question: string;
  expectedAnswer: string;
  studentAnswer: string;
  citations: { excerpt: string; chunkId: string; page?: number | null }[];
}): Promise<ShortAnswerGrade> {
  const promptPath = path.join(process.cwd(), "lib", "llm", "prompts", "short-answer-grader.md");
  const system = await fs.readFile(promptPath, "utf8");
  const evidence = params.citations
    .map((citation) => `Chunk ${citation.chunkId} (page ${citation.page ?? "n/a"}): ${citation.excerpt}`)
    .join("\n");

  const user = `Question: ${params.question}\nExpected answer: ${params.expectedAnswer}\nStudent answer: ${params.studentAnswer}\n\nExcerpts:\n${evidence}`;

  return runStructured({
    model: MODEL,
    system,
    user,
    schemaName: "short_answer_grade",
    schema: ShortAnswerGradeSchema
  });
}
