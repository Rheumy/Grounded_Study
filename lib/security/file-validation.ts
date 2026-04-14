import { fileTypeFromBuffer } from "file-type";
import { imageSize } from "image-size";
import { bytesToDisplayMb } from "@/lib/billing/upload-limits";

const DEFAULT_MAX_MB = 20;
const DEFAULT_MAX_PDF_PAGES = 400;
const DEFAULT_MAX_IMAGE_PIXELS = 25_000_000;

export type AllowedUpload = {
  kind: "pdf" | "image" | "text" | "docx";
  mime: string;
  extension: string;
};

export type UploadValidationResult = {
  allowed: boolean;
  error?: string;
  code?: "FILE_TOO_LARGE";
  meta?: {
    pagesLimit: number;
    imagePixelsLimit: number;
  };
  fileInfo?: AllowedUpload;
  image?: { width: number; height: number };
  oversized?: {
    maxMb: number;
    actualMb: number;
  };
};

const ALLOWED_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/tiff"
]);

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function getValidationMeta() {
  return {
    pagesLimit: Number(process.env.MAX_PDF_PAGES ?? DEFAULT_MAX_PDF_PAGES),
    imagePixelsLimit: Number(process.env.MAX_IMAGE_PIXELS ?? DEFAULT_MAX_IMAGE_PIXELS)
  };
}

export async function validateUpload(
  buffer: Buffer,
  _filename: string,
  size: number,
  options?: { maxMb?: number }
): Promise<UploadValidationResult> {
  const maxMb = options?.maxMb ?? Number(process.env.MAX_UPLOAD_MB ?? DEFAULT_MAX_MB);
  const maxBytes = maxMb * 1024 * 1024;
  const validationMeta = getValidationMeta();

  const type = await fileTypeFromBuffer(buffer);
  if (!type) {
    const isText = buffer
      .slice(0, 2000)
      .every(
        (byte) => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)
      );
    if (isText) {
      if (size > maxBytes) {
        return {
          allowed: false,
          code: "FILE_TOO_LARGE",
          error: "File too large for your current plan.",
          fileInfo: { kind: "text", mime: "text/plain", extension: "txt" },
          meta: validationMeta,
          oversized: { maxMb, actualMb: bytesToDisplayMb(size) }
        };
      }

      return {
        allowed: true,
        fileInfo: { kind: "text", mime: "text/plain", extension: "txt" },
        meta: validationMeta
      };
    }
    return { allowed: false, error: "Unable to detect file type." };
  }

  if (type.mime === "application/pdf") {
    if (size > maxBytes) {
      return {
        allowed: false,
        code: "FILE_TOO_LARGE",
        error: "File too large for your current plan.",
        fileInfo: { kind: "pdf", mime: type.mime, extension: type.ext },
        meta: validationMeta,
        oversized: { maxMb, actualMb: bytesToDisplayMb(size) }
      };
    }

    return {
      allowed: true,
      fileInfo: { kind: "pdf", mime: type.mime, extension: type.ext },
      meta: validationMeta
    };
  }

  if (type.mime === DOCX_MIME) {
    if (size > maxBytes) {
      return {
        allowed: false,
        code: "FILE_TOO_LARGE",
        error: "File too large for your current plan.",
        fileInfo: { kind: "docx", mime: type.mime, extension: type.ext },
        meta: validationMeta,
        oversized: { maxMb, actualMb: bytesToDisplayMb(size) }
      };
    }

    return {
      allowed: true,
      fileInfo: { kind: "docx", mime: type.mime, extension: type.ext },
      meta: validationMeta
    };
  }

  if (ALLOWED_IMAGE_MIMES.has(type.mime)) {
    if (size > maxBytes) {
      return {
        allowed: false,
        code: "FILE_TOO_LARGE",
        error: "File too large for your current plan.",
        fileInfo: { kind: "image", mime: type.mime, extension: type.ext },
        meta: validationMeta,
        oversized: { maxMb, actualMb: bytesToDisplayMb(size) }
      };
    }

    const { width, height } = imageSize(buffer);
    if (!width || !height) {
      return { allowed: false, error: "Invalid image dimensions." };
    }
    const maxPixels = Number(process.env.MAX_IMAGE_PIXELS ?? DEFAULT_MAX_IMAGE_PIXELS);
    if (width * height > maxPixels) {
      return { allowed: false, error: `Image too large. Max pixels ${maxPixels}.` };
    }

    return {
      allowed: true,
      fileInfo: { kind: "image", mime: type.mime, extension: type.ext },
      image: { width, height },
      meta: { ...validationMeta, imagePixelsLimit: maxPixels }
    };
  }

  return { allowed: false, error: `Unsupported file type: ${type.mime}` };
}
