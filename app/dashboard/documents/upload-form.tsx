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

    // Capture the form element immediately (before any await)
    const formEl = event.currentTarget;
    const formData = new FormData(formEl);

    try {
      const response = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        // Handle both JSON and non-JSON error bodies safely
        const contentType = response.headers.get("content-type") || "";
        let message = "Upload failed";

        if (contentType.includes("application/json")) {
          const body = await response.json().catch(() => ({} as any));
          message = body?.error ?? message;
        } else {
          const text = await response.text().catch(() => "");
          if (text) message = text;
        }

        setError(message);
        return;
      }

      // Reset using the captured form element (avoids currentTarget being null)
      formEl.reset();
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-lg border border-dashed border-ink/20 bg-white p-4"
    >
      <input name="file" type="file" accept="application/pdf,text/plain,image/*" required />
      <Button type="submit" disabled={loading}>
        {loading ? "Uploading..." : "Upload"}
      </Button>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </form>
  );
}