import { z } from "zod";

export const StyleProfileSchema = z.object({
  questionTypeDistribution: z.object({
    MCQ: z.number().min(0).max(1),
    SHORT_ANSWER: z.number().min(0).max(1),
    TRUE_FALSE: z.number().min(0).max(1)
  }),
  stemLength: z.object({
    minWords: z.number().int().min(3),
    maxWords: z.number().int().min(5)
  }),
  distractorStyle: z.string().min(3),
  explanationTone: z.string().min(3),
  answerStyle: z.string().min(3),
  difficultyMap: z.object({
    "1": z.string(),
    "2": z.string(),
    "3": z.string(),
    "4": z.string(),
    "5": z.string()
  }),
  preferredTags: z.array(z.string()).optional(),
  notes: z.string().optional()
});

export type StyleProfile = z.infer<typeof StyleProfileSchema>;
