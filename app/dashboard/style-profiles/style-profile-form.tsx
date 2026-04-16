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

    const formEl = event.currentTarget;
    const examplesVal = (formEl.elements.namedItem("examplesText") as HTMLTextAreaElement).value.trim();
    const instructionsVal = (formEl.elements.namedItem("instructionsText") as HTMLTextAreaElement).value.trim();
    const fileInput = formEl.elements.namedItem("sampleFile") as HTMLInputElement;
    const hasFiles = fileInput.files && fileInput.files.length > 0;

    if (!examplesVal && !instructionsVal && !hasFiles) {
      setError(
        "Please provide at least one input: paste sample questions, upload a file, or add instructions."
      );
      return;
    }

    setLoading(true);
    const form = new FormData(formEl);

    const response = await fetch("/api/style-profiles", {
      method: "POST",
      body: form
    });

    setLoading(false);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to save question style");
      return;
    }

    formEl.reset();
    setStatus("Saved. Your question style is ready to use.");
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4">
        <label className="space-y-2">
          <span className="text-sm font-medium text-ink">What exam or course are you studying for?</span>
          <Input
            name="courseName"
            placeholder="e.g. Year 12 biology exam, FRACP rheumatology, first-year anatomy"
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-medium text-ink">What type of questions do you want?</span>
          <Textarea
            name="instructionsText"
            rows={4}
            placeholder="e.g. Case-based MCQs with one best answer and detailed explanations"
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-medium text-ink">
            Paste example questions, model answers, or marking guides
          </span>
          <Textarea
            name="examplesText"
            rows={8}
            placeholder="Paste any sample questions or marking guides here"
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-medium text-ink">Upload example questions or marking keys</span>
          <Input
            name="sampleFile"
            type="file"
            accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,image/*"
            multiple
          />
          <p className="text-xs text-ink/55">Optional</p>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={loading} className="shadow-sm">
          {loading ? "Saving question style..." : "Save question style"}
        </Button>
        {status ? <p className="text-sm text-ink/60">{status}</p> : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
    </form>
  );
}
