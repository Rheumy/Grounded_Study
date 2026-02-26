import { z } from "zod";

export const CitationSchema = z.object({
  chunkId: z.string(),
  excerpt: z.string(),
  page: z.number().int().nullable().optional()
});

export const GeneratedQuestionSchema = z
  .object({
  type: z.enum(["MCQ", "SHORT_ANSWER"]),
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
    if (data.type === "MCQ" && (!data.options || data.options.length < 3)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "MCQ requires at least 3 options."
      });
    }
  });

export type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;
