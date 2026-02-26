import { fileTypeFromBuffer } from "file-type";
import { imageSize } from "image-size";

const DEFAULT_MAX_MB = 20;
const DEFAULT_MAX_PDF_PAGES = 400;
const DEFAULT_MAX_IMAGE_PIXELS = 25_000_000;

export type AllowedUpload = {
  kind: "pdf" | "image" | "text";
  mime: string;
  extension: string;
};

export type UploadValidationResult = {
  allowed: boolean;
  error?: string;
  meta?: {
    pagesLimit: number;
    imagePixelsLimit: number;
  };
  fileInfo?: AllowedUpload;
  image?: { width: number; height: number };
};

export async function validateUpload(buffer: Buffer, _filename: string, size: number): Promise<UploadValidationResult> {
  const maxMb = Number(process.env.MAX_UPLOAD_MB ?? DEFAULT_MAX_MB);
  const maxBytes = maxMb * 1024 * 1024;
  if (size > maxBytes) {
    return { allowed: false, error: `File too large. Max ${maxMb}MB.` };
  }

  const type = await fileTypeFromBuffer(buffer);
  if (!type) {
    const isText = buffer.slice(0, 2000).every((byte) => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126));
    if (isText) {
      return {
        allowed: true,
        fileInfo: { kind: "text", mime: "text/plain", extension: "txt" },
        meta: {
          pagesLimit: Number(process.env.MAX_PDF_PAGES ?? DEFAULT_MAX_PDF_PAGES),
          imagePixelsLimit: Number(process.env.MAX_IMAGE_PIXELS ?? DEFAULT_MAX_IMAGE_PIXELS)
        }
      };
    }
    return { allowed: false, error: "Unable to detect file type." };
  }

  if (type.mime === "application/pdf") {
    return {
      allowed: true,
      fileInfo: { kind: "pdf", mime: type.mime, extension: type.ext },
      meta: {
        pagesLimit: Number(process.env.MAX_PDF_PAGES ?? DEFAULT_MAX_PDF_PAGES),
        imagePixelsLimit: Number(process.env.MAX_IMAGE_PIXELS ?? DEFAULT_MAX_IMAGE_PIXELS)
      }
    };
  }

  if (["image/png", "image/jpeg", "image/jpg"].includes(type.mime)) {
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
      meta: {
        pagesLimit: Number(process.env.MAX_PDF_PAGES ?? DEFAULT_MAX_PDF_PAGES),
        imagePixelsLimit: maxPixels
      }
    };
  }

  return { allowed: false, error: `Unsupported file type: ${type.mime}` };
}
