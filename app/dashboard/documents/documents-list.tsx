"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Doc = {
  id: string;
  title: string;
  status: string;
};

export function DocumentsList({ documents }: { documents: Doc[] }) {
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const onDelete = async (id: string) => {
    setError(null);
    const response = await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Delete failed");
      return;
    }
    router.refresh();
  };

  if (documents.length === 0) {
    return <p className="text-sm text-ink/60">No documents yet.</p>;
  }

  return (
    <div className="space-y-2">
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      <ul className="space-y-2 text-sm">
        {documents.map((doc) => (
          <li key={doc.id} className="flex items-center justify-between rounded-md border border-ink/10 p-3">
            <div>
              <p className="font-medium text-ink">{doc.title}</p>
              <p className="text-xs text-ink/50">Status: {doc.status}</p>
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
