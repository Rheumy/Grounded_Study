import { z } from "zod";

function normalizeChoiceKey(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "");
}

export const CitationSchema = z.object({
  chunkId: z.string().min(1),
  excerpt: z.string().min(5),
  page: z.number().int().nullable().optional()
});

export const GeneratedQuestionSchema = z
  .object({
    type: z.enum(["MCQ", "SHORT_ANSWER", "TRUE_FALSE"]),
    stem: z.string().min(10),
    options: z.array(z.string().min(1)).optional(),
    answer: z.string().min(1),
    rationale: z.string().min(5),
    citations: z.array(CitationSchema).min(1),
    difficulty: z.number().int().min(1).max(5),
    tags: z.array(z.string()).optional(),
    verifierStatus: z.enum(["PENDING", "INSUFFICIENT_EVIDENCE"]).catch("PENDING")
  })
  .superRefine((data, ctx) => {
    if (data.type === "MCQ") {
      if (!data.options || data.options.length !== 4) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "MCQ requires exactly 4 options."
        });
      }

      if (data.options && !data.options.includes(data.answer)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "MCQ answer must exactly match one option."
        });
      }
    }

    if (data.options) {
      const normalizedOptions = data.options.map(normalizeChoiceKey);
      if (new Set(normalizedOptions).size !== normalizedOptions.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Options must be meaningfully distinct."
        });
      }
    }

    if (data.type === "TRUE_FALSE") {
      const opts = data.options ?? [];
      if (
        opts.length !== 2 ||
        !opts.includes("True") ||
        !opts.includes("False")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'TRUE_FALSE requires options ["True", "False"].'
        });
      }

      if (data.answer !== "True" && data.answer !== "False") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'TRUE_FALSE answer must be exactly "True" or "False".'
        });
      }
    }

    const normalizedRationale = normalizeChoiceKey(data.rationale);
    if (
      normalizedRationale &&
      (normalizedRationale === normalizeChoiceKey(data.stem) ||
        normalizedRationale === normalizeChoiceKey(data.answer))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Rationale must explain the answer, not just restate the stem or answer."
      });
    }
  });

export type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;
