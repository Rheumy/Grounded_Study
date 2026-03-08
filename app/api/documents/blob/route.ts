import path from "path";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { sanitizeFilename } from "@/lib/security/sanitize";

const DEFAULT_MAX_MB = 20;
const ALLOWED_CONTENT_TYPES = ["application/pdf", "text/plain", "image/png", "image/jpeg"];
const UUID_LIKE = /^[0-9a-f-]{36}$/i;

function validatePathname(pathnameValue: string, userId: string) {
  const segments = pathnameValue.split("/");
  if (segments.length !== 3) {
    throw new Error("Invalid upload path.");
  }

  const [ownerId, documentId, filename] = segments;
  if (ownerId !== userId || !UUID_LIKE.test(documentId)) {
    throw new Error("Invalid upload path.");
  }

  const safeBase = sanitizeFilename(path.basename(filename));
  if (!filename || filename !== safeBase) {
    throw new Error("Invalid upload filename.");
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid upload request." }, { status: 400 });
  }

  try {
    const jsonResponse = await handleUpload({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      request,
      body,
      onBeforeGenerateToken: async (pathnameValue) => {
        const user = await requireUserApi();
        if (!user) {
          throw new Error("Unauthorized");
        }

        validatePathname(pathnameValue, user.id);

        const maxMb = Number(process.env.MAX_UPLOAD_MB ?? DEFAULT_MAX_MB);
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          addRandomSuffix: false,
          maximumSizeInBytes: maxMb * 1024 * 1024,
          tokenPayload: JSON.stringify({ userId: user.id })
        };
      },
      onUploadCompleted: async () => {
        return;
      }
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload setup failed";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
