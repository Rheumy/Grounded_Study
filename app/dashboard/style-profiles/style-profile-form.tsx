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

    // Client-side guard: at least one content field must be provided
    const examplesVal = (formEl.elements.namedItem("examplesText") as HTMLTextAreaElement).value.trim();
    const instructionsVal = (formEl.elements.namedItem("instructionsText") as HTMLTextAreaElement).value.trim();
    const fileInput = formEl.elements.namedItem("sampleFile") as HTMLInputElement;
    const hasFiles = fileInput.files && fileInput.files.length > 0;
    if (!examplesVal && !instructionsVal && !hasFiles) {
      setError(
        "Please provide at least one input — paste sample questions, upload a file, or add instructions."
      );
      return;
    }

    setLoading(true);
    const form = new FormData();

    // Scalar fields
    form.append("name", (formEl.elements.namedItem("name") as HTMLInputElement).value);
    if (examplesVal) form.append("examplesText", examplesVal);
    if (instructionsVal) form.append("instructionsText", instructionsVal);

    // Multiple sample files (fileInput already resolved above)
    if (fileInput.files) {
      for (const file of Array.from(fileInput.files)) {
        form.append("sampleFile", file);
      }
    }

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

    formEl.reset();
    setStatus("Saved. Choose this format when generating questions.");
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-ink/60">
        Provide at least one of the inputs below. More material produces better results, but only
        one is required.
      </p>

      <div className="space-y-2">
        <label className="text-sm font-medium text-ink">Format name</label>
        <Input name="name" placeholder="e.g. Short-answer revision style" required />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-ink">
          Paste sample questions, model answers, or marking guides
        </label>
        <p className="text-xs text-ink/50">
          Copy and paste example questions that show the style you want. Include model answers or
          marking criteria if you have them.
        </p>
        <Textarea
          name="examplesText"
          rows={6}
          placeholder="Paste sample questions here, for example:&#10;&#10;Q1. What is the function of the mitochondria?&#10;A. Energy production&#10;B. Protein synthesis&#10;C. Cell division&#10;D. Waste removal&#10;Answer: A"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-ink">
          Upload sample files (PDF or images, optional)
        </label>
        <p className="text-xs text-ink/50">
          Upload past exam papers, question sheets, or marking guides as PDF or image files. You
          can select multiple files. Up to 10 pages per file are extracted.
        </p>
        <Input name="sampleFile" type="file" accept="application/pdf,image/*" multiple />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-ink">
          Free-text instructions (optional)
        </label>
        <p className="text-xs text-ink/50">
          Describe any specific requirements not shown in the samples — for example, preferred
          difficulty level, wording style, or topic focus.
        </p>
        <Textarea
          name="instructionsText"
          rows={3}
          placeholder="e.g. Questions should be at A-level standard. Avoid trick questions. Prefer application over recall. Use formal academic language."
        />
      </div>

      <Button type="submit" disabled={loading}>
        {loading ? "Analysing and saving..." : "Save question format"}
      </Button>
      {status ? <p className="text-xs text-ink/60">{status}</p> : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </form>
  );
}
