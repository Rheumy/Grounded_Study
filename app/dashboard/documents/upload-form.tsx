"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function UploadForm() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(event.currentTarget);

    const response = await fetch("/api/documents/upload", {
      method: "POST",
      body: form
    });

    setLoading(false);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Upload failed");
      return;
    }

    event.currentTarget.reset();
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-dashed border-ink/20 bg-white p-4">
      <input name="file" type="file" accept="application/pdf,text/plain,image/*" required />
      <Button type="submit" disabled={loading}>
        {loading ? "Uploading..." : "Upload"}
      </Button>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </form>
  );
}
