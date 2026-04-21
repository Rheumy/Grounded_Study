import { z } from "zod";

export const AssumedBackgroundLevelSchema = z.enum(["novice", "generalist", "specialist"]);

export type AssumedBackgroundLevel = z.infer<typeof AssumedBackgroundLevelSchema>;

export function normalizeAssumedBackgroundLevel(value: unknown): AssumedBackgroundLevel {
  if (typeof value !== "string") {
    return "generalist";
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (
    normalized === "novice" ||
    normalized === "beginner" ||
    normalized === "entry_level" ||
    normalized === "high_school" ||
    normalized === "intro" ||
    normalized === "introductory"
  ) {
    return "novice";
  }

  if (
    normalized === "generalist" ||
    normalized === "general" ||
    normalized === "intermediate" ||
    normalized === "professional" ||
    normalized === "undergraduate"
  ) {
    return "generalist";
  }

  if (
    normalized === "specialist" ||
    normalized === "advanced" ||
    normalized === "board_exam" ||
    normalized === "board_style" ||
    normalized === "expert" ||
    normalized === "fellowship" ||
    normalized === "postgraduate"
  ) {
    return "specialist";
  }

  return "generalist";
}

export function describeOutsiderForBackgroundLevel(
  level: AssumedBackgroundLevel
): string {
  switch (level) {
    case "novice":
      return "any adult without relevant education";
    case "specialist":
      return "a generalist in the field who has not studied the specific source";
    case "generalist":
    default:
      return "someone with general education in the field";
  }
}

export const StyleProfileSchema = z.object({
  questionTypeDistribution: z.object({
    MCQ: z.number().min(0).max(1),
    SHORT_ANSWER: z.number().min(0).max(1),
    TRUE_FALSE: z.number().min(0).max(1)
  }),
  assumedBackgroundLevel: AssumedBackgroundLevelSchema.default("generalist").catch("generalist"),
  stemLength: z
    .object({
      minWords: z.number().int().min(3).catch(8),
      maxWords: z.number().int().min(5).catch(30)
    })
    .default({ minWords: 8, maxWords: 30 })
    .catch({ minWords: 8, maxWords: 30 }),
  distractorStyle: z.string().min(3),
  explanationTone: z.string().min(3),
  answerStyle: z.string().min(3).optional(),
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
