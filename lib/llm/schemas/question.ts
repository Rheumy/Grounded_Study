import { z } from "zod";

export const CitationSchema = z.object({
  chunkId: z.string(),
  excerpt: z.string(),
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
    verifierStatus: z.enum(["PENDING", "INSUFFICIENT_EVIDENCE"])
  })
  .superRefine((data, ctx) => {
    if (data.type === "MCQ") {
      if (!data.options || data.options.length !== 4) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "MCQ requires exactly 4 options."
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
    }
  });

export type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;
