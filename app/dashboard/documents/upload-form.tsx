"use client";

import { put } from "@vercel/blob/client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

type BlobInitResponse = {
  clientToken: string;
};

async function parseErrorResponse(response: Response, fallback: string) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await response.json().catch(() => ({} as { error?: string }));
    return body.error ?? fallback;
  }

  const text = await response.text().catch(() => "");
  return text || fallback;
}

export function UploadForm({
  userId,
  useClientUploads
}: {
  userId: string;
  useClientUploads: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), ms);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    // Capture the form element immediately (before any await)
    const formEl = event.currentTarget;
    const formData = new FormData(formEl);
    const file = formData.get("file");

    try {
      if (!file || !(file instanceof File)) {
        setError("File missing");
        return;
      }

      let response: Response;
      if (useClientUploads) {
        const documentId = crypto.randomUUID();
        const storageKey = `${userId}/${documentId}/${sanitizeFilename(file.name)}`;
        const multipart = file.size > 4_500_000;
        console.info("Starting blob upload init", {
          storageKey,
          fileName: file.name,
          fileType: file.type || null,
          fileSize: file.size,
          multipart
        });

        const initResponse = await fetch("/api/documents/blob", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            type: "blob.generate-client-token",
            payload: {
              pathname: storageKey,
              clientPayload: null,
              multipart
            }
          })
        });

        if (!initResponse.ok) {
          const message = await parseErrorResponse(
            initResponse,
            "Blob upload initialization failed."
          );
          console.error("Blob upload init failed", {
            storageKey,
            status: initResponse.status,
            message
          });
          setError(message);
          return;
        }

        const initJson = (await initResponse.json().catch(() => null)) as BlobInitResponse | null;
        if (!initJson?.clientToken) {
          console.error("Blob upload init returned an unexpected response", {
            storageKey,
            body: initJson
          });
          setError("Blob upload initialization returned an invalid response.");
          return;
        }

        console.info("Blob upload token issued", { storageKey, multipart });

        let blob;
        try {
          blob = await withTimeout(
            put(storageKey, file, {
              access: "private",
              token: initJson.clientToken,
              multipart
            }),
            120_000,
            "Blob upload did not complete in time."
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Blob upload failed before finalization.";
          console.error("Blob upload failed", {
            storageKey,
            fileName: file.name,
            fileType: file.type || null,
            error
          });
          setError(
            `Blob upload failed. ${message} Check the browser console and network panel for the failing Blob request.`
          );
          return;
        }

        console.info("Blob upload completed, starting finalize", {
          storageKey: blob.pathname
        });

        response = await fetch("/api/documents/upload", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            storageKey: blob.pathname,
            fileName: file.name
          })
        });
      } else {
        response = await fetch("/api/documents/upload", {
          method: "POST",
          body: formData
        });
      }

      if (!response.ok) {
        const message = await parseErrorResponse(response, "Upload failed");
        console.error("Upload finalize failed", {
          status: response.status,
          message
        });
        setError(message);
        return;
      }

      console.info("Upload finalize completed");
      // Reset using the captured form element (avoids currentTarget being null)
      formEl.reset();
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      console.error("Upload failed", e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-lg border border-dashed border-ink/20 bg-white p-4"
      data-testid="document-upload-form"
    >
      <input
        name="file"
        type="file"
        accept="application/pdf,text/plain,image/*"
        required
        data-testid="document-upload-input"
      />
      <Button type="submit" disabled={loading} data-testid="document-upload-submit">
        {loading ? "Uploading..." : "Upload"}
      </Button>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </form>
  );
}
