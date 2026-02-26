import { getOpenAIClient } from "@/lib/llm/openai";

const DEFAULT_VISION_MODEL = "gpt-4o-mini";

export async function ocrImage(buffer: Buffer, contentType: string): Promise<string> {
  const client = getOpenAIClient();
  const base64 = buffer.toString("base64");
  const response = await client.chat.completions.create({
    model: process.env.OPENAI_VISION_MODEL ?? DEFAULT_VISION_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Extract all visible text. Preserve math and symbols. Output plain text only." },
          {
            type: "image_url",
            image_url: {
              url: `data:${contentType};base64,${base64}`
            }
          }
        ]
      }
    ],
    max_tokens: 2000
  });

  return response.choices[0]?.message?.content?.trim() ?? "";
}
