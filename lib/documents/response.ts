import type { Document, IngestionJob } from "@prisma/client";

export type DocumentsListItem = {
  id: string;
  title: string;
  status: string;
  createdAt: string | null;
  latestError: string | null;
};

type DocumentWithLatestIngestionJob = Pick<Document, "id" | "title" | "status" | "createdAt"> & {
  ingestionJobs?: Array<Pick<IngestionJob, "lastError">> | null;
};

const KNOWN_DOCUMENT_STATUSES = new Set(["QUEUED", "PROCESSING", "READY", "OCR_DISABLED", "FAILED"]);

function safeIsoDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function toDocumentsListItem(document: DocumentWithLatestIngestionJob): DocumentsListItem {
  const title = safeString(document.title);
  const status = safeString(document.status);
  const latestError = safeString(document.ingestionJobs?.[0]?.lastError);

  return {
    id: document.id,
    title: title || "Untitled study material",
    status: KNOWN_DOCUMENT_STATUSES.has(status) ? status : "UNKNOWN",
    createdAt: safeIsoDate(document.createdAt),
    latestError: latestError || null
  };
}

export function toDocumentsListItems(documents: DocumentWithLatestIngestionJob[]) {
  return documents.map(toDocumentsListItem);
}
