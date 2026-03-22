import fs from "fs/promises";
import path from "path";
import { getOpenAIClient } from "@/lib/llm/openai";
import { logger } from "@/lib/observability/logger";
import type { GeneratedQuestion } from "@/lib/llm/schemas/question";

const MODEL = "gpt-4o-mini";

export type VerifierResult = { status: "PASSED" | "FAILED"; reason: string };

// ---------------------------------------------------------------------------
// Normalise the model's raw verifier response.
// The prompt asks for PASSED/FAILED but the model sometimes returns PASS/FAIL,
// SUFFICIENT_EVIDENCE, YES/NO, or echoes back fields from the question JSON.
// Conservative default: anything not clearly positive → FAILED.
// ---------------------------------------------------------------------------
function normalizeVerifierResponse(raw: unknown): VerifierResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { status: "FAILED", reason: "Verifier returned unexpected response shape" };
  }

  const obj = raw as Record<string, unknown>;

  const reason =
    String(obj.reason ?? obj.explanation ?? obj.message ?? obj.details ?? "").trim() ||
    "No reason provided";

  const rawStatus = String(obj.status ?? obj.verdict ?? obj.result ?? "")
    .trim()
    .toUpperCase();

  const isPass =
    rawStatus === "PASSED" ||
    rawStatus === "PASS" ||
    rawStatus === "SUFFICIENT_EVIDENCE" ||
    rawStatus === "YES" ||
    rawStatus === "TRUE" ||
    rawStatus === "VALID" ||
    rawStatus === "OK";

  return { status: isPass ? "PASSED" : "FAILED", reason };
}

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
    logger.warn({}, "Verifier returned empty response");
    return { status: "FAILED", reason: "Verifier returned empty response" };
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawText);
  } catch {
    logger.warn({ rawPreview: rawText.slice(0, 300) }, "Verifier returned non-JSON response");
    return { status: "FAILED", reason: "Verifier returned non-JSON response" };
  }

  const result = normalizeVerifierResponse(rawJson);
  logger.info(
    { status: result.status, reason: result.reason.slice(0, 200) },
    "Verifier result"
  );
  return result;
}
