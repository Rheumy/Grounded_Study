import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getOpenAIClient } from "@/lib/llm/openai";

export async function runStructured<T extends z.ZodTypeAny>(params: {
  model: string;
  system: string;
  user: string;
  schemaName: string;
  schema: T;
}) {
  const client = getOpenAIClient();
  const jsonSchema = zodToJsonSchema(params.schema, params.schemaName);

  try {
    const response = await client.responses.create({
      model: params.model,
      input: [
        { role: "system", content: params.system },
        { role: "user", content: params.user }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: params.schemaName,
          schema: jsonSchema,
          strict: true
        }
      }
    });

    const rawText =
      (response as { output_text?: string }).output_text ??
      response.output?.[0]?.content?.find((item: { text?: string }) => item.text)?.text;

    if (!rawText) {
      throw new Error("No structured response received.");
    }

    const json = JSON.parse(rawText);
    return params.schema.parse(json) as z.infer<T>;
  } catch (error) {
    const fallback = await client.chat.completions.create({
      model: params.model,
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user }
      ],
      response_format: { type: "json_object" }
    });
    const rawText = fallback.choices[0]?.message?.content;
    if (!rawText) throw error;
    const json = JSON.parse(rawText);
    return params.schema.parse(json) as z.infer<T>;
  }
}
