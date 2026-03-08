import { promises as fs } from "fs";
import path from "path";
import { del, get, put } from "@vercel/blob";

export type StoredFile = {
  storageKey: string;
  contentType: string;
  size: number;
};

const uploadsDir = process.env.UPLOADS_DIR ?? "./uploads";

export function isBlobEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function saveFile(
  buffer: Buffer,
  storageKey: string,
  contentType: string
): Promise<StoredFile> {
  if (process.env.NODE_ENV === "production" && !isBlobEnabled()) {
    throw new Error("Uploads are disabled: Vercel Blob not configured.");
  }

  if (isBlobEnabled()) {
    const blob = await put(storageKey, buffer, { access: "private", contentType });
    return { storageKey: blob.pathname, contentType, size: buffer.length };
  }

  const fullPath = path.join(uploadsDir, storageKey);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, buffer);
  return { storageKey, contentType, size: buffer.length };
}

export async function readFile(storageKey: string): Promise<Buffer> {
  if (isBlobEnabled()) {
    const accessModes: Array<"private" | "public"> = ["private", "public"];

    for (const access of accessModes) {
      try {
        const response = await get(storageKey, { access });
        if (response && response.statusCode === 200 && response.stream) {
          const blobBuffer = await new Response(response.stream).arrayBuffer();
          return Buffer.from(blobBuffer);
        }
      } catch {
        // Fall through to the next access mode.
      }
    }

    throw new Error("Unable to read blob file.");
  }

  const fullPath = path.join(uploadsDir, storageKey);
  return fs.readFile(fullPath);
}

export async function deleteFile(storageKey: string): Promise<void> {
  if (isBlobEnabled()) {
    await del(storageKey);
    return;
  }
  const fullPath = path.join(uploadsDir, storageKey);
  await fs.rm(fullPath, { force: true });
}
