import { z } from "zod";

export const FailureCodeSchema = z.enum([
  "UNSUPPORTED_STEM",
  "UNSUPPORTED_ANSWER",
  "UNSUPPORTED_RATIONALE",
  "AMBIGUOUS_QUESTION",
  "MULTIPLE_POSSIBLE_ANSWERS",
  "WEAK_DISTRACTORS",
  "INVALID_TRUE_FALSE",
  "OVERREACHING_MODEL_ANSWER",
  "MISSING_CITATIONS",
  "BAD_CITATION_LINKAGE",
  "RETRIEVAL_JARGON",
  "LOW_EDUCATIONAL_VALUE",
  "INVALID_STRUCTURE"
]);

export const VerifierSchema = z.object({
  status: z.enum(["PASSED", "FAILED"]),
  reason: z.string().min(3),
  failureCodes: z.array(FailureCodeSchema).optional(),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]).optional()
});

export type FailureCode = z.infer<typeof FailureCodeSchema>;
export type VerifierResult = z.infer<typeof VerifierSchema>;
