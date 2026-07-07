"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { DocumentsListItem } from "@/lib/documents/response";

type Doc = DocumentsListItem;

const LONG_PROCESSING_MS = 10 * 60 * 1000;

function getStatusLabel(status: string): string {
  if (status === "QUEUED") return "Queued";
  if (status === "PROCESSING") return "Processing";
  if (status === "READY") return "Ready";
  if (status === "OCR_DISABLED") return "Failed";
  if (status === "FAILED") return "Failed";
  return "Needs attention";
}

function normalizeDocumentItem(value: unknown): Doc | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) return null;

  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "Untitled study material";
  const status = typeof raw.status === "string" && raw.status.trim() ? raw.status.trim() : "UNKNOWN";
  const createdAt = typeof raw.createdAt === "string" && Number.isFinite(Date.parse(raw.createdAt)) ? raw.createdAt : null;
  const latestError = typeof raw.latestError === "string" && raw.latestError.trim() ? raw.latestError.trim() : null;

  return { id, title, status, createdAt, latestError };
}

export function getStatusMessage(doc: Doc, now = Date.now()): string {
  if (doc.status === "QUEUED") {
    return "Queued for processing. Background processing will continue even if you leave this page.";
  }

  if (doc.status === "PROCESSING") {
    const createdAt = doc.createdAt ? new Date(doc.createdAt).getTime() : null;
    const isLongRunning = createdAt !== null && Number.isFinite(createdAt) && now - createdAt > LONG_PROCESSING_MS;

    if (isLongRunning) {
      return "This is taking longer than usual. Larger PDFs or temporary AI service delays can take extra time. You can leave this page and check back later.";
    }

    return "Processing your study material now. Small documents often process within a few minutes; larger PDFs may take longer. You can leave this page and come back.";
  }

  if (doc.status === "READY") {
    return "Ready to use. Next: go to Create Questions.";
  }

  if (doc.status === "OCR_DISABLED") {
    return "Text extraction for this image upload is not available in the current deployment.";
  }

  if (doc.status === "FAILED") {
    return doc.latestError ?? "Processing failed. Try uploading again or ask an admin to inspect the job.";
  }

  return "This study material has an unexpected processing state. Please try refreshing the page, or ask an admin to inspect it.";
}

export function toggleSelectedDocumentId(selectedIds: string[], documentId: string, checked: boolean) {
  if (checked) {
    return Array.from(new Set([...selectedIds, documentId]));
  }

  return selectedIds.filter((id) => id !== documentId);
}

export function toggleAllSelectedDocumentIds(documentIds: string[], checked: boolean) {
  return checked ? [...documentIds] : [];
}

export function buildDeleteDocumentRequestInit(deleteAssociatedQuestions: boolean): RequestInit {
  return {
    method: "DELETE",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ deleteAssociatedQuestions })
  };
}

export function DocumentsList({ documents }: { documents: Doc[] }) {
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Doc[]>(() =>
    documents.map(normalizeDocumentItem).filter((doc): doc is Doc => doc !== null)
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmingIds, setConfirmingIds] = useState<string[] | null>(null);
  const [deleteAssociatedQuestions, setDeleteAssociatedQuestions] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const normalizedDocuments = documents.map(normalizeDocumentItem).filter((doc): doc is Doc => doc !== null);
    setItems(normalizedDocuments);
    setSelectedIds((prev) => prev.filter((id) => normalizedDocuments.some((doc) => doc.id === id)));
  }, [documents]);

  useEffect(() => {
    const hasPendingDocuments = items.some((doc) => doc.status === "QUEUED" || doc.status === "PROCESSING");
    if (!hasPendingDocuments) return;

    const interval = setInterval(async () => {
      const response = await fetch("/api/documents", { cache: "no-store" });
      if (!response.ok) return;

      const body = await response.json().catch(() => null);
      if (!body?.documents || !Array.isArray(body.documents)) {
        setError("We could not refresh your study materials. Please reload the page.");
        return;
      }

      const refreshedItems = (body.documents as unknown[])
        .map(normalizeDocumentItem)
        .filter((doc): doc is Doc => doc !== null);
      setItems(refreshedItems);
      setSelectedIds((prev) => prev.filter((id) => refreshedItems.some((doc) => doc.id === id)));
      router.refresh();
    }, 3000);

    return () => clearInterval(interval);
  }, [items, router]);

  const allItemIds = items.map((doc) => doc.id);
  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const confirmingDocuments = confirmingIds
    ? items.filter((doc) => confirmingIds.includes(doc.id))
    : [];

  const openDeleteConfirmation = (ids: string[]) => {
    if (ids.length === 0) return;
    setError(null);
    setConfirmingIds(ids);
    setDeleteAssociatedQuestions(true);
  };

  const onDelete = async () => {
    if (!confirmingIds || confirmingIds.length === 0 || deleting) return;

    setError(null);
    setDeleting(true);

    const deletedIds: string[] = [];
    for (const id of confirmingIds) {
      const response = await fetch(`/api/documents/${id}`, buildDeleteDocumentRequestInit(deleteAssociatedQuestions));
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Delete failed");
        break;
      }
      deletedIds.push(id);
    }

    if (deletedIds.length > 0) {
      setItems((prev) => prev.filter((doc) => !deletedIds.includes(doc.id)));
      setSelectedIds((prev) => prev.filter((id) => !deletedIds.includes(id)));
      router.refresh();
    }

    setDeleting(false);
    setConfirmingIds(null);
  };

  if (items.length === 0) {
    return <p className="text-sm text-ink/60">No study materials uploaded yet.</p>;
  }

  return (
    <div className="space-y-2">
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-ink/10 bg-ink/[0.02] p-3 text-sm">
        <label className="flex items-center gap-2 text-ink/70">
          <input
            type="checkbox"
            checked={allSelected}
            aria-label="Select all study materials"
            onChange={(event) => setSelectedIds(toggleAllSelectedDocumentIds(allItemIds, event.currentTarget.checked))}
            className="h-4 w-4 rounded border-ink/20"
          />
          Select all
        </label>
        <button
          type="button"
          disabled={selectedIds.length === 0}
          onClick={() => openDeleteConfirmation(selectedIds)}
          className="rounded-md border border-danger/30 px-3 py-2 text-xs font-medium text-danger disabled:cursor-not-allowed disabled:border-ink/10 disabled:text-ink/35"
        >
          Delete selected
        </button>
      </div>
      <ul className="space-y-2 text-sm">
        {items.map((doc) => (
          <li key={doc.id} className="flex items-start justify-between gap-3 rounded-md border border-ink/10 p-3">
            <label className="flex min-w-0 flex-1 items-start gap-3">
              <input
                type="checkbox"
                checked={selectedIds.includes(doc.id)}
                aria-label={`Select ${doc.title}`}
                onChange={(event) =>
                  setSelectedIds((prev) => toggleSelectedDocumentId(prev, doc.id, event.currentTarget.checked))
                }
                className="mt-1 h-4 w-4 shrink-0 rounded border-ink/20"
              />
              <div className="min-w-0 space-y-1">
                <span className="block truncate font-medium text-ink">{doc.title}</span>
                <p className="text-xs text-ink/50">Status: {getStatusLabel(doc.status)}</p>
                <p
                  className={`text-xs ${
                    doc.status === "FAILED" || doc.status === "OCR_DISABLED" ? "text-danger" : "text-ink/60"
                  }`}
                >
                  {getStatusMessage(doc)}
                </p>
              </div>
            </label>
            <button
              className="text-xs text-danger"
              type="button"
              onClick={() => openDeleteConfirmation([doc.id])}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      {confirmingIds ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-documents-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
        >
          <div className="w-full max-w-lg space-y-4 rounded-lg bg-white p-5 shadow-xl">
            <div className="space-y-2">
              <h2 id="delete-documents-title" className="text-base font-semibold text-ink">
                Delete selected study material?
              </h2>
              <p className="text-sm text-ink/70">
                This will permanently delete the selected uploaded study material and extracted text.
              </p>
              <p className="text-xs text-ink/55">
                {confirmingDocuments.length === 1
                  ? confirmingDocuments[0].title
                  : `${confirmingDocuments.length} study materials selected`}
              </p>
            </div>
            <label className="flex items-start gap-2 rounded-md border border-ink/10 bg-ink/[0.02] p-3 text-sm text-ink/75">
              <input
                type="checkbox"
                checked={deleteAssociatedQuestions}
                onChange={(event) => setDeleteAssociatedQuestions(event.currentTarget.checked)}
                className="mt-1 h-4 w-4 shrink-0 rounded border-ink/20"
              />
              <span>
                <span className="block font-medium text-ink">
                  Also remove generated questions based on these documents
                </span>
                <span className="block text-xs text-ink/55">
                  If you keep associated questions, they may lose their supporting source material.
                </span>
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmingIds(null)}
                className="rounded-md border border-ink/15 px-3 py-2 text-sm font-medium text-ink/70"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={onDelete}
                className="rounded-md bg-danger px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
