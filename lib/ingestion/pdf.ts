import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";

export type PdfPageText = { page: number; text: string };

type PdfWorkerGlobal = typeof globalThis & {
  pdfjsWorker?: {
    WorkerMessageHandler?: unknown;
  };
};

const pdfWorkerGlobal = globalThis as PdfWorkerGlobal;
if (!pdfWorkerGlobal.pdfjsWorker?.WorkerMessageHandler) {
  pdfWorkerGlobal.pdfjsWorker = {
    WorkerMessageHandler: pdfjsWorker.WorkerMessageHandler
  };
}

export async function extractPdfText(buffer: Buffer, maxPages: number): Promise<PdfPageText[]> {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  const pages: PdfPageText[] = [];
  const totalPages = Math.min(pdf.numPages, maxPages);

  for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) {
      pages.push({ page: pageNum, text });
    }
  }

  return pages;
}
