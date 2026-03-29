import fs from "fs/promises";
import path from "path";
import { getOpenAIClient } from "@/lib/llm/openai";
import { type ShortAnswerGrade } from "@/lib/llm/schemas/grading";

const MODEL = "gpt-4o-mini";

// ---------------------------------------------------------------------------
// Normalise the model's raw grading response.
// The prompt requests CORRECT / INCORRECT / NEEDS_REVIEW but the model may
// return aliases like PASS/FAIL, YES/NO, RIGHT/WRONG, or partial words.
// ---------------------------------------------------------------------------
function normalizeGradeResponse(raw: unknown): ShortAnswerGrade {
  const fallback: ShortAnswerGrade = { verdict: "NEEDS_REVIEW", reason: "Could not parse grading response" };

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;

  const obj = raw as Record<string, unknown>;
  const reason =
    String(obj.reason ?? obj.explanation ?? obj.message ?? obj.feedback ?? "").trim() ||
    "No reason provided";

  const rawVerdict = String(obj.verdict ?? obj.result ?? obj.grade ?? obj.score ?? "")
    .trim()
    .toUpperCase();

  let verdict: "CORRECT" | "INCORRECT" | "NEEDS_REVIEW";
  if (
    rawVerdict === "CORRECT" ||
    rawVerdict === "PASS" ||
    rawVerdict === "YES" ||
    rawVerdict === "RIGHT" ||
    rawVerdict === "TRUE"
  ) {
    verdict = "CORRECT";
  } else if (
    rawVerdict === "INCORRECT" ||
    rawVerdict === "WRONG" ||
    rawVerdict === "FAIL" ||
    rawVerdict === "FAILED" ||
    rawVerdict === "NO" ||
    rawVerdict === "FALSE"
  ) {
    verdict = "INCORRECT";
  } else {
    verdict = "NEEDS_REVIEW";
  }

  return { verdict, reason };
}

export async function gradeShortAnswer(params: {
  question: string;
  expectedAnswer: string;
  studentAnswer: string;
  citations: { excerpt: string; chunkId: string; page?: number | null }[];
}): Promise<ShortAnswerGrade> {
  const promptPath = path.join(process.cwd(), "lib", "llm", "prompts", "short-answer-grader.md");
  const system = await fs.readFile(promptPath, "utf8");
  const evidence = params.citations
    .map(
      (citation) => `Chunk ${citation.chunkId} (page ${citation.page ?? "n/a"}): ${citation.excerpt}`
    )
    .join("\n");

  const user = `Question: ${params.question}\nExpected answer: ${params.expectedAnswer}\nStudent answer: ${params.studentAnswer}\n\nExcerpts:\n${evidence}`;

  const client = getOpenAIClient();
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    response_format: { type: "json_object" }
  });

  const rawText = response.choices[0]?.message?.content ?? "";
  if (!rawText) {
    return { verdict: "NEEDS_REVIEW", reason: "Grader returned empty response" };
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawText);
  } catch {
    return { verdict: "NEEDS_REVIEW", reason: "Grader returned non-JSON response" };
  }

  return normalizeGradeResponse(rawJson);
}
