"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Doc = {
  id: string;
  title: string;
  status: string;
  latestError: string | null;
};

function getStatusLabel(status: string): string {
  if (status === "QUEUED") return "Queued";
  if (status === "PROCESSING") return "Processing";
  if (status === "READY") return "Ready";
  if (status === "OCR_DISABLED") return "Failed";
  if (status === "FAILED") return "Failed";
  return status;
}

function getStatusMessage(doc: Doc): string {
  if (doc.status === "QUEUED") {
    return "Queued for processing. We will start ingesting this file automatically.";
  }

  if (doc.status === "PROCESSING") {
    return "Processing your study material now.";
  }

  if (doc.status === "READY") {
    return "Ready to use. Next: go to Generate Questions.";
  }

  if (doc.status === "OCR_DISABLED") {
    return "Text extraction for this image upload is not available in the current deployment.";
  }

  if (doc.status === "FAILED") {
    return doc.latestError ?? "Processing failed. Try uploading again or ask an admin to inspect the job.";
  }

  return `Status: ${doc.status}`;
}

export function DocumentsList({ documents }: { documents: Doc[] }) {
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Doc[]>(documents);
  const router = useRouter();

  useEffect(() => {
    setItems(documents);
  }, [documents]);

  useEffect(() => {
    const hasPendingDocuments = items.some((doc) => doc.status === "QUEUED" || doc.status === "PROCESSING");
    if (!hasPendingDocuments) return;

    const interval = setInterval(async () => {
      const response = await fetch("/api/documents", { cache: "no-store" });
      if (!response.ok) return;

      const body = await response.json().catch(() => null);
      if (!body?.documents || !Array.isArray(body.documents)) return;

      setItems(body.documents as Doc[]);
      router.refresh();
    }, 3000);

    return () => clearInterval(interval);
  }, [items, router]);

  const onDelete = async (id: string) => {
    setError(null);
    const response = await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Delete failed");
      return;
    }

    setItems((prev) => prev.filter((doc) => doc.id !== id));
    router.refresh();
  };

  if (items.length === 0) {
    return <p className="text-sm text-ink/60">No study materials uploaded yet.</p>;
  }

  return (
    <div className="space-y-2">
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      <ul className="space-y-2 text-sm">
        {items.map((doc) => (
          <li key={doc.id} className="flex items-center justify-between rounded-md border border-ink/10 p-3">
            <div className="space-y-1">
              <p className="font-medium text-ink">{doc.title}</p>
              <p className="text-xs text-ink/50">Status: {getStatusLabel(doc.status)}</p>
              <p className={`text-xs ${doc.status === "FAILED" || doc.status === "OCR_DISABLED" ? "text-danger" : "text-ink/60"}`}>
                {getStatusMessage(doc)}
              </p>
            </div>
            <button
              className="text-xs text-danger"
              type="button"
              onClick={() => onDelete(doc.id)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
