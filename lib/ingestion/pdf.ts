import * as pdfjs from "pdfjs-dist/legacy/build/pdf.js";

export type PdfPageText = { page: number; text: string };

export async function extractPdfText(buffer: Buffer, maxPages: number): Promise<PdfPageText[]> {
  const loadingTask = pdfjs.getDocument({ data: buffer, disableWorker: true });
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
