import mammoth from "mammoth";

/**
 * Extract plain text from a .docx (Office Open XML) buffer.
 * Returns the extracted text, or an empty string if extraction fails.
 */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}
