import fs from "fs/promises";
import path from "path";
import { runStructured } from "@/lib/llm/structured";
import { StyleProfileSchema, type StyleProfile } from "@/lib/llm/schemas/style-profile";

const MODEL = "gpt-4o-mini";

export async function extractStyleProfile(params: {
  name: string;
  examplesText?: string | null;
  examplesImagesText?: string | null;
}): Promise<StyleProfile> {
  const promptPath = path.join(process.cwd(), "lib", "llm", "prompts", "style-profile.md");
  const system = await fs.readFile(promptPath, "utf8");

  const user = `Style profile name: ${params.name}\n\nExamples (text):\n${params.examplesText ?? "(none)"}\n\nExamples (OCR):\n${params.examplesImagesText ?? "(none)"}`;

  return runStructured({
    model: MODEL,
    system,
    user,
    schemaName: "style_profile",
    schema: StyleProfileSchema
  });
}
