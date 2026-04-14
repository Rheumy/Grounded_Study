import type { AllowedUpload } from "@/lib/security/file-validation";

export function resolveDocumentSourceType(
  kind: AllowedUpload["kind"]
): "PDF" | "IMAGE" | "TEXT" {
  switch (kind) {
    case "pdf":
      return "PDF";
    case "image":
      return "IMAGE";
    case "text":
      return "TEXT";
    case "docx":
      // Prisma currently has no DOCX enum variant, so DOCX uploads persist as TEXT
      // and are handled via contentType-aware extraction during ingestion.
      return "TEXT";
  }
}
