import crypto from "crypto";

export type Chunk = {
  content: string;
  page?: number;
};

export function chunkText(text: string, maxChars = 1200, overlap = 200): string[] {
  if (!text.trim()) return [];
  const sentences = text.split(/\n+/g).map((line) => line.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length + sentence.length + 1 <= maxChars) {
      current = current ? `${current} ${sentence}` : sentence;
      continue;
    }
    if (current) {
      chunks.push(current);
      const overlapText = current.slice(Math.max(0, current.length - overlap));
      current = overlapText ? `${overlapText} ${sentence}` : sentence;
    } else {
      chunks.push(sentence.slice(0, maxChars));
      current = sentence.slice(Math.max(0, sentence.length - overlap));
    }
  }

  if (current) chunks.push(current);
  return chunks.map((chunk) => chunk.trim()).filter(Boolean);
}

export function hashChunk(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}
