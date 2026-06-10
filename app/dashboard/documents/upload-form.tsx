"use client";

import { put } from "@vercel/blob/client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type UploadStatus =
  | "waiting"
  | "checking"
  | "uploading"
  | "finalizing"
  | "ingesting"
  | "ready"
  | "failed"
  | "interrupted";

type UploadItem = {
  id: string;
  file?: File;
  name: string;
  status: UploadStatus;
  documentId?: string;
  error?: string;
  message?: string;
  checkingStartedAt?: number;
};

export type PersistedUploadItem = {
  id: string;
  name: string;
  status: UploadStatus;
  documentId?: string;
  error?: string;
  updatedAt: number;
  checkingStartedAt?: number;
};

type DocumentStatusForUpload = {
  id: string;
  title?: string;
  status: string;
  createdAt?: string | Date;
};

export const RECENT_UPLOAD_BATCH_STORAGE_KEY = "grounded-study:recent-upload-batch:v1";
const RECENT_UPLOAD_STALE_MS = 2 * 60 * 60 * 1000;
export const UPLOAD_RECONCILE_GRACE_MS = 45 * 1000;
const INTERRUPTED_UPLOAD_MESSAGE = "This file was not uploaded before you left this page. Please select it again.";
const RECONCILED_UPLOAD_MESSAGE = "This document was uploaded and is shown below.";
const CHECKING_UPLOAD_MESSAGE =
  "This document may still be uploading or processing. We are checking the document list below.";
const PROCESSING_WAIT_COPY =
  "Small documents often process within a few minutes. Larger PDFs may take longer. You can leave this page and come back.";

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

const statusLabels: Record<UploadStatus, string> = {
  waiting: "Waiting",
  checking: "Checking upload status…",
  uploading: "Uploading",
  finalizing: "Uploading",
  ingesting: "Processing",
  ready: "Ready",
  failed: "Failed",
  interrupted: "Needs selection"
};

function createUploadItem(file: File): UploadItem {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${file.name}-${file.size}-${Date.now()}`,
    file,
    name: file.name,
    status: "waiting"
  };
}

export function getUploadSummary(items: Array<Pick<UploadItem, "status">>) {
  const counts = {
    waiting: 0,
    uploading: 0,
    processing: 0,
    ready: 0,
    failed: 0,
    interrupted: 0
  };

  for (const item of items) {
    if (item.status === "waiting") counts.waiting += 1;
    if (item.status === "uploading" || item.status === "finalizing") counts.uploading += 1;
    if (item.status === "checking" || item.status === "ingesting") counts.processing += 1;
    if (item.status === "ready") counts.ready += 1;
    if (item.status === "failed") counts.failed += 1;
    if (item.status === "interrupted") counts.interrupted += 1;
  }

  return counts;
}

export function toPersistedUploadItems(
  items: Array<Pick<UploadItem, "id" | "name" | "status" | "documentId" | "error" | "checkingStartedAt">>,
  now = Date.now()
): PersistedUploadItem[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    status: item.status,
    documentId: item.documentId,
    error: item.error,
    updatedAt: now,
    checkingStartedAt: item.checkingStartedAt
  }));
}

export function restorePersistedUploadItems(
  items: PersistedUploadItem[],
  now = Date.now(),
  documents: DocumentStatusForUpload[] = []
): UploadItem[] {
  return items
    .filter((item) => now - item.updatedAt <= RECENT_UPLOAD_STALE_MS)
    .map((item) => reconcilePersistedUploadItem(item, documents, now));
}

function mapDocumentStatusToUploadStatus(status: string): UploadStatus {
  if (status === "READY") return "ready";
  if (status === "QUEUED" || status === "PROCESSING") return "ingesting";
  if (status === "FAILED" || status === "OCR_DISABLED") return "failed";
  return "ingesting";
}

function getDocumentCreatedAtMs(document: DocumentStatusForUpload) {
  if (!document.createdAt) return 0;
  const value = document.createdAt instanceof Date ? document.createdAt.getTime() : Date.parse(document.createdAt);
  return Number.isFinite(value) ? value : 0;
}

export function findRestoredUploadDocumentMatch(
  item: { name: string; documentId?: string; [key: string]: unknown },
  documents: DocumentStatusForUpload[]
) {
  if (item.documentId) {
    return documents.find((document) => document.id === item.documentId);
  }

  const restoredName = item.name.trim();
  if (!restoredName) return undefined;

  const matches = documents
    .filter((document) => (document.title ?? "").trim() === restoredName)
    .sort((left, right) => getDocumentCreatedAtMs(right) - getDocumentCreatedAtMs(left));

  return matches[0];
}

export function reconcilePersistedUploadItem(
  item: PersistedUploadItem,
  documents: DocumentStatusForUpload[],
  now = Date.now()
): UploadItem {
  const matchingDocument = findRestoredUploadDocumentMatch(item, documents);

  if (matchingDocument) {
    return {
      id: item.id,
      name: item.name,
      status: mapDocumentStatusToUploadStatus(matchingDocument.status),
      documentId: matchingDocument.id,
      error:
        matchingDocument.status === "FAILED" || matchingDocument.status === "OCR_DISABLED"
          ? item.error
          : undefined,
      message: RECONCILED_UPLOAD_MESSAGE
    };
  }

  if (!item.documentId && item.status === "waiting") {
    return {
      id: item.id,
      name: item.name,
      status: "interrupted",
      documentId: item.documentId,
      error: INTERRUPTED_UPLOAD_MESSAGE
    };
  }

  const shouldCheck =
    !item.documentId &&
    (item.status === "uploading" ||
      item.status === "finalizing" ||
      item.status === "ingesting" ||
      item.status === "checking");

  if (shouldCheck) {
    const checkingStartedAt = item.checkingStartedAt ?? now;
    if (now - checkingStartedAt >= UPLOAD_RECONCILE_GRACE_MS) {
      return {
        id: item.id,
        name: item.name,
        status: "interrupted",
        documentId: item.documentId,
        error: INTERRUPTED_UPLOAD_MESSAGE
      };
    }

    return {
      id: item.id,
      name: item.name,
      status: "checking",
      documentId: item.documentId,
      error: undefined,
      message: CHECKING_UPLOAD_MESSAGE,
      checkingStartedAt
    };
  }

  return {
    id: item.id,
    name: item.name,
    status: item.status,
    documentId: item.documentId,
    error: item.error,
    ...(item.checkingStartedAt !== undefined ? { checkingStartedAt: item.checkingStartedAt } : {})
  };
}

export function reconcileUploadItemsWithDocuments(
  items: UploadItem[],
  documents: DocumentStatusForUpload[],
  now = Date.now()
): UploadItem[] {
  return items.map((item) =>
    item.status === "checking" && !item.documentId
      ? reconcilePersistedUploadItem(
          {
            id: item.id,
            name: item.name,
            status: item.status,
            error: item.error,
            updatedAt: now,
            checkingStartedAt: item.checkingStartedAt
          },
          documents,
          now
        )
      : item
  );
}

export function writePersistedUploadItems(
  storage: Pick<Storage, "setItem">,
  items: Array<Pick<UploadItem, "id" | "name" | "status" | "documentId" | "error" | "checkingStartedAt">>,
  now = Date.now()
) {
  storage.setItem(RECENT_UPLOAD_BATCH_STORAGE_KEY, JSON.stringify(toPersistedUploadItems(items, now)));
}

export function readPersistedUploadItems(
  storage: Pick<Storage, "getItem" | "removeItem">,
  now = Date.now(),
  documents: DocumentStatusForUpload[] = []
) {
  const raw = storage.getItem(RECENT_UPLOAD_BATCH_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as PersistedUploadItem[];
    if (!Array.isArray(parsed)) {
      storage.removeItem(RECENT_UPLOAD_BATCH_STORAGE_KEY);
      return [];
    }
    const restored = restorePersistedUploadItems(parsed, now, documents);
    if (restored.length === 0) {
      storage.removeItem(RECENT_UPLOAD_BATCH_STORAGE_KEY);
    }
    return restored;
  } catch {
    storage.removeItem(RECENT_UPLOAD_BATCH_STORAGE_KEY);
    return [];
  }
}

export function clearPersistedUploadItems(storage: Pick<Storage, "removeItem">) {
  storage.removeItem(RECENT_UPLOAD_BATCH_STORAGE_KEY);
}

export function getReadyUploadDocumentIds(
  items: Array<Pick<UploadItem, "documentId" | "status">>,
  documents: DocumentStatusForUpload[] = []
) {
  const documentStatusById = new Map(documents.map((document) => [document.id, document.status]));
  const readyIds = new Set<string>();

  for (const item of items) {
    if (!item.documentId) continue;
    if (item.status === "ready" || documentStatusById.get(item.documentId) === "READY") {
      readyIds.add(item.documentId);
    }
  }

  return Array.from(readyIds);
}

export function buildAutogenerateQuestionsUrl(params: {
  documentIds: string[];
  questionMix: QuestionMix;
  count: number;
}) {
  const searchParams = new URLSearchParams({
    questionMix: params.questionMix,
    count: String(params.count)
  });

  params.documentIds.forEach((documentId) => {
    searchParams.append("autogenerateDocumentId", documentId);
  });

  return `/dashboard/generate?${searchParams.toString()}`;
}

export const buildAutogeneratePracticeUrl = buildAutogenerateQuestionsUrl;

export async function runUploadBatch<TItem extends { id: string; name: string }>(params: {
  items: TItem[];
  uploadOne: (item: TItem, index: number) => Promise<{ documentId: string; status: string }>;
  onProgress?: (message: string) => void;
  onSuccess?: (item: TItem, result: { documentId: string; status: string }) => void;
  onFailure?: (item: TItem, message: string) => void;
}) {
  const readyDocumentIds: string[] = [];

  for (let index = 0; index < params.items.length; index += 1) {
    const item = params.items[index];
    params.onProgress?.(`Uploading ${index + 1} of ${params.items.length}...`);

    try {
      const result = await params.uploadOne(item, index);
      params.onSuccess?.(item, result);
      if (result.status === "READY") {
        readyDocumentIds.push(result.documentId);
      }
    } catch (uploadError) {
      const message =
        uploadError instanceof Error
          ? uploadError.message
          : "This file could not be uploaded. Please check the file type and size.";
      params.onFailure?.(item, message);
    }
  }

  return readyDocumentIds;
}

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
  useClientUploads,
  documents = []
}: {
  userId: string;
  useClientUploads: boolean;
  documents?: DocumentStatusForUpload[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [questionMix, setQuestionMix] = useState<QuestionMix>("MCQ");
  const [questionCount, setQuestionCount] = useState(10);
  const router = useRouter();

  const persistItems = (nextItems: UploadItem[]) => {
    if (typeof window === "undefined") return;
    writePersistedUploadItems(window.sessionStorage, nextItems);
  };

  const updateItem = (id: string, patch: Partial<UploadItem>) => {
    setItems((prev) => {
      const nextItems = prev.map((item) => (item.id === id ? { ...item, ...patch } : item));
      persistItems(nextItems);
      return nextItems;
    });
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const restoredItems = readPersistedUploadItems(window.sessionStorage, Date.now(), documents);
    if (restoredItems.length === 0) return;

    setItems(restoredItems);
    persistItems(restoredItems);

    const hasInterruptedItems = restoredItems.some((item) => item.status === "interrupted");
    const hasDocumentBackedItems = restoredItems.some((item) => Boolean(item.documentId));
    const hasCheckingItems = restoredItems.some((item) => item.status === "checking");
    if (hasInterruptedItems) {
      setUploadStatus("Some selected files were not uploaded before you left this page. Please select them again.");
      return;
    }
    if (hasCheckingItems) {
      setUploadStatus("Checking upload status…");
      return;
    }
    if (hasDocumentBackedItems) {
      setUploadStatus("Recently uploaded documents continue processing below.");
    }
  }, [documents]);

  useEffect(() => {
    const hasCheckingItems = items.some((item) => item.status === "checking" && !item.documentId);
    if (!hasCheckingItems || typeof window === "undefined") return;

    let cancelled = false;

    async function reconcileFromServer() {
      const response = await fetch("/api/documents", { cache: "no-store" }).catch(() => null);
      if (cancelled || !response?.ok) return;

      const body = await response.json().catch(() => null);
      if (cancelled || !Array.isArray(body?.documents)) return;

      setItems((prev) => {
        const nextItems = reconcileUploadItemsWithDocuments(
          prev,
          body.documents as DocumentStatusForUpload[],
          Date.now()
        );
        persistItems(nextItems);
        return nextItems;
      });
      router.refresh();
    }

    void reconcileFromServer();
    const interval = setInterval(() => {
      void reconcileFromServer();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [items, router]);

  const readyDocumentIds = useMemo(
    () => getReadyUploadDocumentIds(items, documents),
    [documents, items]
  );
  const summary = getUploadSummary(items);
  const hasInterruptedItems = items.some((item) => item.status === "interrupted");
  const hasDocumentBackedItems = items.some((item) => Boolean(item.documentId));
  const hasCompletedBatch =
    items.length > 0 && items.every((item) => item.status === "ready" || item.status === "failed" || item.status === "interrupted");
  const canGenerateFromReadyDocuments = !loading && readyDocumentIds.length > 0;

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

  async function uploadOneFile(item: UploadItem) {
    const file = item.file;
    if (!file) {
      throw new Error("Please select this file again.");
    }
    let response: Response;

    updateItem(item.id, { status: "uploading", error: undefined });

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
          "This file could not be uploaded. Please check the file type and size."
        );
        console.error("Blob upload init failed", {
          storageKey,
          status: initResponse.status,
          message
        });
        throw new Error(message);
      }

      const initJson = (await initResponse.json().catch(() => null)) as BlobInitResponse | null;
      if (!initJson?.clientToken) {
        console.error("Blob upload init returned an unexpected response", {
          storageKey,
          body: initJson
        });
        throw new Error("This file could not be uploaded. Please try again.");
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
        throw new Error(`This file could not be uploaded. ${message}`);
      }

      console.info("Blob upload completed, starting finalize", {
        storageKey: blob.pathname
      });

      updateItem(item.id, { status: "finalizing" });
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
      const formData = new FormData();
      formData.append("file", file);

      response = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData
      });
    }

    if (!response.ok) {
      const message = await parseErrorResponse(
        response,
        "This file could not be uploaded. Please check the file type and size."
      );
      console.error("Upload finalize failed", {
        status: response.status,
        message
      });
      throw new Error(message);
    }

    console.info("Upload finalize completed");
    const uploadBody = (await response.json().catch(() => null)) as UploadFinalizeResponse | null;
    const documentId = uploadBody?.documentId;
    if (!documentId) {
      throw new Error("Upload completed but the document could not be tracked.");
    }

    updateItem(item.id, { status: "ingesting", documentId });
    router.refresh();

    const ingestResponse = await fetch("/api/documents/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documentId })
    });
    const ingestBody = (await ingestResponse.json().catch(() => null)) as IngestResponse | null;

    if (!ingestResponse.ok || !ingestBody?.ok) {
      throw new Error(
        ingestBody && "error" in ingestBody
          ? ingestBody.error
          : "This document could not be processed. Please try another file."
      );
    }

    updateItem(item.id, { status: ingestBody.status === "READY" ? "ready" : "ingesting", documentId });
    return { documentId, status: ingestBody.status };
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;

    setError(null);
    setLoading(true);

    const formEl = event.currentTarget;
    const formData = new FormData(formEl);
    const selectedFiles = formData
      .getAll("file")
      .filter((file): file is File => file instanceof File && file.size > 0);

    if (selectedFiles.length === 0) {
      setError("Choose at least one file.");
      setLoading(false);
      return;
    }

    const batchItems = selectedFiles.map(createUploadItem);
    setItems(batchItems);
    persistItems(batchItems);
    setUploadStatus(`${batchItems.length} ${batchItems.length === 1 ? "file" : "files"} selected`);

    const readyIds = await runUploadBatch({
      items: batchItems,
      uploadOne: uploadOneFile,
      onProgress: setUploadStatus,
      onFailure: (item, message) => {
        console.error("Upload failed for file", { fileName: item.name, message });
        updateItem(item.id, { status: "failed", error: message });
      }
    });

    router.refresh();
    setLoading(false);

    if (readyIds.length === 0) {
      setUploadStatus("No documents are ready yet.");
      setError("No documents could be processed. Please check the file type and size.");
      return;
    }

    setError(null);
    setUploadStatus(
      `${readyIds.length} of ${batchItems.length} ${
        batchItems.length === 1 ? "document is" : "documents are"
      } ready`
    );

    if (batchItems.length === 1) {
      formEl.reset();
      router.push(
        buildAutogenerateQuestionsUrl({
          documentIds: readyIds,
          questionMix,
          count: questionCount
        })
      );
    }
  };

  const resetSelection = () => {
    setItems([]);
    setError(null);
    setUploadStatus(null);
    if (typeof window !== "undefined") {
      clearPersistedUploadItems(window.sessionStorage);
    }
  };

  const generateFromReadyDocuments = () => {
    if (readyDocumentIds.length === 0) return;
    router.push(
      buildAutogenerateQuestionsUrl({
        documentIds: readyDocumentIds,
        questionMix,
        count: questionCount
      })
    );
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
        multiple
        accept="application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,image/*"
        required
        data-testid="document-upload-input"
        onChange={(event) => {
          const selectedFiles = Array.from(event.currentTarget.files ?? []);
          const nextItems = selectedFiles.map(createUploadItem);
          setItems(nextItems);
          persistItems(nextItems);
          setError(null);
          setUploadStatus(
            selectedFiles.length > 0
              ? `${selectedFiles.length} ${selectedFiles.length === 1 ? "file" : "files"} selected`
              : null
          );
        }}
      />
      {items.length > 0 ? (
        <div className="space-y-3 rounded-md border border-ink/10 bg-ink/[0.02] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink">
              {items.length} {items.length === 1 ? "file" : "files"} selected
            </p>
            {items.length > 0 && !loading ? (
              <button
                type="button"
                onClick={resetSelection}
                className="text-xs font-medium text-ink/55 hover:text-ink"
              >
                Clear upload history
              </button>
            ) : null}
          </div>
          <div className="grid gap-2 text-xs text-ink/60 sm:grid-cols-5">
            <span>Waiting: {summary.waiting}</span>
            <span>Uploading: {summary.uploading}</span>
            <span>Processing: {summary.processing}</span>
            <span>Ready: {summary.ready}</span>
            <span>Failed: {summary.failed}</span>
          </div>
          {summary.interrupted > 0 ? (
            <p className="text-xs text-ink/60">Needs selection: {summary.interrupted}</p>
          ) : null}
          {loading ? (
            <p className="text-xs text-ink/60">
              Stay on this page until uploads start. Once a document appears below, background processing will continue even if you navigate away.
            </p>
          ) : null}
          {!loading && hasInterruptedItems ? (
            <p className="text-xs text-ink/60">
              Some selected files were not uploaded before you left this page. Please select them again.
            </p>
          ) : null}
          {!loading && hasDocumentBackedItems ? (
            <p className="text-xs text-ink/60">
              Recently uploaded documents continue processing below. {PROCESSING_WAIT_COPY}
            </p>
          ) : null}
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="grid gap-1 rounded-md border border-ink/10 bg-white p-3 text-sm sm:grid-cols-[1fr_auto]"
              >
                <span className="min-w-0 truncate text-ink">{item.name}</span>
                <span
                  className={[
                    "text-xs font-medium",
                    item.status === "ready"
                      ? "text-accent"
                      : item.status === "failed" || item.status === "interrupted"
                        ? "text-danger"
                        : "text-ink/55"
                  ].join(" ")}
                >
                  {statusLabels[item.status]}
                </span>
                {item.error ? (
                  <p className="text-xs text-danger sm:col-span-2">{item.error}</p>
                ) : null}
                {item.message ? (
                  <p className="text-xs text-ink/60 sm:col-span-2">{item.message}</p>
                ) : null}
              </li>
            ))}
          </ul>
          {hasCompletedBatch && summary.failed > 0 && summary.ready > 0 ? (
            <p className="text-xs text-ink/60">
              Some files failed. You can still generate from the ready documents.
            </p>
          ) : null}
          {!loading && summary.processing > 0 && summary.ready > 0 ? (
            <p className="text-xs text-ink/60">
              Some files are still processing. You can generate from the ready documents now, or wait.
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-3 rounded-md border border-ink/10 bg-ink/[0.02] p-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink">Questions to prepare</p>
          <p className="text-xs text-ink/55">
            We&apos;ll start generating these as soon as your document is ready. {PROCESSING_WAIT_COPY}
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
      {canGenerateFromReadyDocuments && readyDocumentIds.length > 1 ? (
        <Button type="button" onClick={generateFromReadyDocuments} data-testid="generate-ready-documents">
          Generate questions from ready documents
        </Button>
      ) : null}
      {canGenerateFromReadyDocuments && readyDocumentIds.length === 1 ? (
        <Button type="button" onClick={generateFromReadyDocuments} data-testid="generate-ready-documents">
          Generate questions from ready document
        </Button>
      ) : null}
      {uploadStatus ? <p className="text-xs text-ink/60">Status: {uploadStatus}</p> : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </form>
  );
}
