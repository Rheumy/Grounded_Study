import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import { LegalDocument } from "@/components/legal/legal-document";

const LEGAL_PAGES = {
  terms: {
    title: "Terms of Service",
    filename: "terms.md"
  },
  privacy: {
    title: "Privacy Policy",
    filename: "privacy.md"
  },
  "acceptable-use": {
    title: "Acceptable Use Policy",
    filename: "acceptable-use.md"
  }
} as const;

export function generateStaticParams() {
  return Object.keys(LEGAL_PAGES).map((slug) => ({ slug }));
}

export default async function LegalPage({
  params
}: {
  params: { slug: keyof typeof LEGAL_PAGES };
}) {
  const page = LEGAL_PAGES[params.slug];
  if (!page) {
    notFound();
  }

  const content = await readFile(
    path.join(process.cwd(), "content", "legal", page.filename),
    "utf8"
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-ink/45">Legal</p>
        <h1 className="text-3xl font-semibold text-ink">{page.title}</h1>
      </div>
      <div className="rounded-3xl border border-ink/10 bg-white p-6 shadow-sm">
        <LegalDocument content={content} />
      </div>
    </div>
  );
}

