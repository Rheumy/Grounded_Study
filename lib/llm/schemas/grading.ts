import { z } from "zod";

export const ShortAnswerGradeSchema = z.object({
  verdict: z.enum(["CORRECT", "INCORRECT", "NEEDS_REVIEW"]),
  reason: z.string().min(3)
});

export type ShortAnswerGrade = z.infer<typeof ShortAnswerGradeSchema>;
