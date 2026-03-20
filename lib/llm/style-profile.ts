import fs from "fs/promises";
import path from "path";
import { runStructured } from "@/lib/llm/structured";
import { StyleProfileSchema, type StyleProfile } from "@/lib/llm/schemas/style-profile";

const MODEL = "gpt-4o-mini";

export async function extractStyleProfile(params: {
  name: string;
  examplesText?: string | null;
  examplesImagesText?: string | null;
  sampleFilesText?: string | null;
  instructionsText?: string | null;
}): Promise<StyleProfile> {
  const promptPath = path.join(process.cwd(), "lib", "llm", "prompts", "style-profile.md");
  const system = await fs.readFile(promptPath, "utf8");

  const sections = [
    `Style profile name: ${params.name}`,
    `\nPasted sample questions / model answers / marking guides:\n${params.examplesText ?? "(none)"}`,
    `\nExtracted text from uploaded sample files (PDF/images):\n${
      [params.sampleFilesText, params.examplesImagesText].filter(Boolean).join("\n\n---\n\n") || "(none)"
    }`,
    `\nFree-text instructions from user:\n${params.instructionsText ?? "(none)"}`
  ];

  const user = sections.join("\n");

  return runStructured({
    model: MODEL,
    system,
    user,
    schemaName: "style_profile",
    schema: StyleProfileSchema
  });
}
