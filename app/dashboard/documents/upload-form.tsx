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

type UploadFinalizeResponse = {
  documentId: string;
  status: string;
};

type IngestResponse =
  | { ok: true; status: string }
  | { ok: false; status: string; error: string };

type QuestionMix = "MCQ" | "TRUE_FALSE" | "MIXED";

const questionMixOptions: { value: QuestionMix; label: string }[] = [
  { value: "MCQ", label: "Multiple choice only" },
  { value: "TRUE_FALSE", label: "True/false only" },
  { value: "MIXED", label: "Mixed (50/50 split)" }
];

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
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [questionMix, setQuestionMix] = useState<QuestionMix>("MCQ");
  const [questionCount, setQuestionCount] = useState(10);
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
    setUploadStatus("Uploading");

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
      const uploadBody = (await response.json().catch(() => null)) as UploadFinalizeResponse | null;
      const documentId = uploadBody?.documentId;
      if (!documentId) {
        setError("Upload completed but the document could not be tracked.");
        return;
      }

      setUploadStatus("Queued");
      router.refresh();
      setUploadStatus("Processing");

      const ingestResponse = await fetch("/api/documents/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentId })
      });
      const ingestBody = (await ingestResponse.json().catch(() => null)) as IngestResponse | null;

      if (!ingestResponse.ok || !ingestBody?.ok) {
        setUploadStatus("Failed");
        setError(ingestBody && "error" in ingestBody ? ingestBody.error : "Document processing failed.");
        router.refresh();
        return;
      }

      setUploadStatus(ingestBody.status === "READY" ? "Ready" : ingestBody.status === "PROCESSING" ? "Processing" : "Queued");
      // Reset using the captured form element (avoids currentTarget being null)
      formEl.reset();
      if (ingestBody.status === "READY") {
        const params = new URLSearchParams({
          autogenerateDocumentId: documentId,
          questionMix,
          count: String(questionCount)
        });
        router.push(`/dashboard/practice?${params.toString()}`);
        return;
      }
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      console.error("Upload failed", e);
      setUploadStatus("Failed");
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
        accept="application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,image/*"
        required
        data-testid="document-upload-input"
      />
      <div className="grid gap-3 rounded-md border border-ink/10 bg-ink/[0.02] p-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink">Questions to prepare</p>
          <p className="text-xs text-ink/55">
            We&apos;ll start generating these as soon as your document is ready. This usually takes 2-5 minutes.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {questionMixOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={questionMix === option.value}
              onClick={() => setQuestionMix(option.value)}
              className={[
                "min-h-[44px] rounded-md border px-3 py-2 text-left text-sm font-medium transition",
                questionMix === option.value
                  ? "border-accent/30 bg-accentSoft/40 text-ink ring-1 ring-accent/20"
                  : "border-ink/10 bg-white text-ink/70 hover:bg-ink/[0.02]"
              ].join(" ")}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="grid gap-1 text-sm text-ink/75">
          <span className="font-medium text-ink">How many questions?</span>
          <input
            type="number"
            min={1}
            max={30}
            value={questionCount}
            onChange={(event) => {
              const value = Number(event.target.value);
              setQuestionCount(Math.min(30, Math.max(1, Number.isFinite(value) ? Math.round(value) : 10)));
            }}
            className="h-10 w-32 rounded-md border border-ink/15 bg-white px-3 text-sm"
          />
        </label>
      </div>
      <Button type="submit" disabled={loading} data-testid="document-upload-submit">
        {loading ? "Uploading..." : "Upload material"}
      </Button>
      {uploadStatus ? <p className="text-xs text-ink/60">Status: {uploadStatus}</p> : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </form>
  );
}
