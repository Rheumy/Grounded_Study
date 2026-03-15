"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function StyleProfileForm() {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setStatus(null);
    setLoading(true);
    const form = new FormData(event.currentTarget);

    const response = await fetch("/api/style-profiles", {
      method: "POST",
      body: form
    });

    setLoading(false);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to save question format");
      return;
    }

    event.currentTarget.reset();
    setStatus("Saved. Next: choose this format when generating questions.");
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-2">
        <label className="text-sm font-medium text-ink">Format name</label>
        <Input name="name" placeholder="e.g. Short-answer revision style" required />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium text-ink">
          Describe the question format or paste sample questions
        </label>
        <Textarea
          name="examplesText"
          placeholder="Describe the format in your own words, or paste sample questions here."
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium text-ink">
          Upload sample questions, marking guides, or model answers (optional)
        </label>
        <Input name="image" type="file" accept="image/*" />
      </div>
      <Button type="submit" disabled={loading}>
        {loading ? "Saving..." : "Save question format"}
      </Button>
      {status ? <p className="text-xs text-ink/60">{status}</p> : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </form>
  );
}
