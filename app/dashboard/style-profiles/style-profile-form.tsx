"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  PRESETS_IN_DISPLAY_ORDER,
  resolvePreset,
  type PresetKey
} from "@/lib/llm/presets";

export function StyleProfileForm() {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedPresetKey, setSelectedPresetKey] = useState<PresetKey | "">("");
  const [guidanceText, setGuidanceText] = useState("");
  const router = useRouter();

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setStatus(null);

    const formEl = event.currentTarget;
    const guidanceVal = (formEl.elements.namedItem("guidanceText") as HTMLTextAreaElement).value.trim();
    const fileInput = formEl.elements.namedItem("sampleFile") as HTMLInputElement;
    const hasFiles = fileInput.files && fileInput.files.length > 0;

    if (!guidanceVal && !hasFiles) {
      setError(
        "Please add guidance or upload a file so we can build your question style."
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
    setSelectedPresetKey("");
    setGuidanceText("");
    setStatus("Saved. Your question style is ready to use.");
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4">
        <label className="space-y-2">
          <span className="text-sm font-medium text-ink">Start from a preset</span>
          <select
            className="h-10 w-full rounded-md border border-ink/15 bg-white px-3 text-sm text-ink shadow-sm focus:outline-none focus:ring-2 focus:ring-accent"
            value={selectedPresetKey}
            onChange={(event) => {
              const nextKey = event.target.value as PresetKey | "";
              setSelectedPresetKey(nextKey);
              const preset = resolvePreset(nextKey);
              if (preset) {
                setGuidanceText(preset.starterGuidance);
              }
            }}
          >
            <option value="">Start from scratch</option>
            {PRESETS_IN_DISPLAY_ORDER.map((preset) => (
              <option key={preset.key} value={preset.key}>
                {preset.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-ink/55">
            Optional. Choosing a preset fills the guidance box so you can customize from a ready-made starting point.
          </p>
        </label>

        <label className="space-y-2">
          <span className="text-sm font-medium text-ink">What exam or course are you studying for?</span>
          <Input
            name="courseName"
            placeholder="e.g. Year 12 biology exam, FRACP rheumatology, first-year anatomy"
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-medium text-ink">
            Describe the questions you want, or paste example questions and marking guides
          </span>
          <Textarea
            name="guidanceText"
            rows={10}
            value={guidanceText}
            onChange={(event) => setGuidanceText(event.target.value)}
            placeholder="e.g. Advanced exam-style questions with applied reasoning, or paste example questions, model answers, and marking guides"
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
