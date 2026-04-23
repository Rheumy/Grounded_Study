"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_QUESTION_STYLE_PRESET_KEY,
  PRESETS_IN_DISPLAY_ORDER,
  resolvePreset,
  type PresetKey
} from "@/lib/llm/presets";

type Doc = { id: string; title: string };
type Profile = {
  id: string;
  name: string;
  distribution: { MCQ?: number; SHORT_ANSWER?: number; TRUE_FALSE?: number } | null;
};
type GenerationResult = { questionId?: string; status: string; reason?: string };
type GenerationSummary = {
  requestedCount: number;
  passedCount: number;
  failedCount: number;
  primaryFailureReason?: string | null;
};
type StyleSelectionMode = "preset" | "custom";

function describeGenerationFailure(reason?: string | null): string {
  const normalized = reason?.trim().toLowerCase() ?? "";

  if (
    /background knowledge|field[- ]general|general knowledge|headline|summary|without reading|specific material|specific source|cited source|too basic|too general|widely known/.test(
      normalized
    )
  ) {
    return "No question was saved because the generated item was too general and could be answered without needing the source.";
  }

  if (/invalid response|non-json|validation|schema/.test(normalized)) {
    return "No question was saved because a clean grounded question could not be formed from the selected material.";
  }

  return "No question was saved because the generated item could not be supported cleanly enough from the selected source.";
}

const difficultyOptions = [
  { value: 1, label: "Easy" },
  { value: 2, label: "Moderate" },
  { value: 3, label: "Standard exam level" },
  { value: 4, label: "Challenging" },
  { value: 5, label: "Very challenging" }
] as const;

export function GenerateForm({
  documents,
  profiles,
  maxRequestCount
}: {
  documents: Doc[];
  profiles: Profile[];
  maxRequestCount: number;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<GenerationSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState(3);
  const [count, setCount] = useState(5);
  const [styleSelectionMode, setStyleSelectionMode] = useState<StyleSelectionMode>("preset");
  const [selectedPresetKey, setSelectedPresetKey] = useState<PresetKey>(
    DEFAULT_QUESTION_STYLE_PRESET_KEY
  );
  const [selectedStyleProfileId, setSelectedStyleProfileId] = useState<string>("");

  const toggleDoc = (id: string) => {
    setSelectedDocs((prev) =>
      prev.includes(id) ? prev.filter((doc) => doc !== id) : [...prev, id]
    );
  };

  const selectedProfile = profiles.find((profile) => profile.id === selectedStyleProfileId) ?? null;
  const selectedPreset = resolvePreset(selectedPresetKey) ?? PRESETS_IN_DISPLAY_ORDER[0];
  const activeDistribution =
    styleSelectionMode === "custom"
      ? selectedProfile?.distribution ?? null
      : selectedPreset.styleProfile.questionTypeDistribution;
  const shortAnswerGuidanceVisible = (activeDistribution?.SHORT_ANSWER ?? 0) > 0;
  const customStyleMissing = styleSelectionMode === "custom" && !selectedStyleProfileId;

  const submit = async () => {
    setError(null);
    setSummary(null);
    setStatus(null);
    if (styleSelectionMode === "custom" && !selectedStyleProfileId) {
      setError("Choose a saved custom style or use one of the built-in styles.");
      return;
    }
    setLoading(true);
    setStatus("Your questions are being built from your study material.");
    try {
      const response = await fetch("/api/questions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentIds: selectedDocs,
          styleProfileId:
            styleSelectionMode === "custom" ? selectedStyleProfileId || null : null,
          presetKey: styleSelectionMode === "preset" ? selectedPreset.key : null,
          difficulty,
          count
        })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Generation failed");
        setStatus(null);
        return;
      }

      const body = await response.json().catch(() => ({} as {
        results?: GenerationResult[];
        summary?: GenerationSummary;
      }));
      const results = Array.isArray(body.results) ? (body.results as GenerationResult[]) : [];
      const passedCount = body.summary?.passedCount ?? results.filter((r) => r.status === "PASSED").length;
      const failedCount = body.summary?.failedCount ?? Math.max(0, results.length - passedCount);
      const primaryFailureReason =
        results.find((result) => result.status !== "PASSED")?.reason ?? null;

      setSummary({
        requestedCount: body.summary?.requestedCount ?? count,
        passedCount,
        failedCount,
        primaryFailureReason
      });
      setStatus(null);
    } catch {
      setError("Generation failed. Please try again.");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  const isDisabled = selectedDocs.length === 0 || loading || customStyleMissing;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">Question style</p>
        <p className="text-sm text-ink/60">
          Start with a built-in style, or choose a saved custom style if you want a more exam-specific setup.
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {PRESETS_IN_DISPLAY_ORDER.map((preset) => {
            const isSelected =
              styleSelectionMode === "preset" && selectedPreset.key === preset.key;
            return (
              <button
                key={preset.key}
                type="button"
                aria-pressed={isSelected}
                onClick={() => {
                  setStyleSelectionMode("preset");
                  setSelectedPresetKey(preset.key);
                }}
                className={`space-y-2 rounded-2xl border p-4 text-left transition ${
                  isSelected
                    ? "border-accent/30 bg-accentSoft/40 shadow-sm ring-1 ring-accent/20"
                    : "border-ink/10 bg-white hover:bg-ink/[0.02]"
                }`}
              >
                <p className="text-sm font-medium text-ink">{preset.label}</p>
                <p className="text-xs text-ink/60">{preset.description}</p>
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={styleSelectionMode === "custom"}
            onClick={() => setStyleSelectionMode("custom")}
            className={`space-y-2 rounded-2xl border p-4 text-left transition ${
              styleSelectionMode === "custom"
                ? "border-accent/30 bg-accentSoft/40 shadow-sm ring-1 ring-accent/20"
                : "border-ink/10 bg-white hover:bg-ink/[0.02]"
            }`}
          >
            <p className="text-sm font-medium text-ink">Use a custom style</p>
            <p className="text-xs text-ink/60">
              Select one of your saved question styles to match a specific exam, tone, or format.
            </p>
          </button>
        </div>
        {styleSelectionMode === "custom" ? (
          <div className="space-y-2 rounded-md border border-ink/10 bg-ink/[0.02] p-4">
            <p className="text-xs text-ink/60">
              Choose a saved Question Style created from your own examples. It shapes wording, level,
              and the question mix for this run.
            </p>
            {profiles.length > 0 ? (
              <select
                className="h-10 w-full rounded-md border border-ink/15 bg-white px-3 text-sm"
                value={selectedStyleProfileId}
                onChange={(event) => setSelectedStyleProfileId(event.target.value)}
              >
                <option value="">Select a saved custom style</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-ink/65">
                No saved Question Styles yet.{" "}
                <Link href="/dashboard/style-profiles" className="font-medium text-accent hover:underline">
                  Create one
                </Link>{" "}
                to guide tone, level, and exam style.
              </p>
            )}
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">Choose study materials</p>
        <p className="text-sm text-ink/60">
          Select one or more ready study materials to generate questions from.
        </p>
        {documents.length === 0 ? (
          <p className="text-sm text-ink/60">No ready study materials available.</p>
        ) : (
          <div className="grid gap-2">
            {documents.map((doc) => (
              <label key={doc.id} className="flex items-center gap-2 text-sm text-ink/70">
                <input
                  type="checkbox"
                  checked={selectedDocs.includes(doc.id)}
                  onChange={() => toggleDoc(doc.id)}
                />
                {doc.title}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-ink">Question difficulty</label>
        <p className="text-sm text-ink/60">Choose how challenging you want the questions to be.</p>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {difficultyOptions.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant={difficulty === option.value ? "default" : "outline"}
              onClick={() => setDifficulty(option.value)}
              className="h-auto min-h-[44px] px-3 py-3 text-sm"
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-ink">Number of questions</label>
        <input
          type="number"
          min={1}
          max={maxRequestCount}
          value={count}
          onChange={(event) => {
            const rawNextCount = Number(event.target.value);
            const nextCount = Math.min(maxRequestCount, Math.max(1, rawNextCount || 1));
            setCount(nextCount);
          }}
          className="h-10 w-full rounded-md border border-ink/15 bg-white px-3 text-sm"
        />
        <p className="text-xs text-ink/55">You can create up to {maxRequestCount} questions in one run.</p>
      </div>

      <div className="space-y-2 rounded-md border border-ink/10 bg-ink/[0.02] p-4">
        <p className="text-xs text-ink/55">
          Current MCQ generation uses exactly 4 options.
        </p>
        {styleSelectionMode === "preset" ? (
          <p className="text-xs text-ink/55">
            Built-in styles resolve to a baked-in question profile before generation starts.
          </p>
        ) : selectedProfile?.distribution ? (
          <p className="text-xs text-ink/55">
            This style decides the question mix for this run based on the saved profile.
          </p>
        ) : null}
        {shortAnswerGuidanceVisible ? (
          <p className="text-xs text-ink/55">
            Short-answer feedback is strongest when your materials or saved question style include model
            answers, marking guides, or rubrics. Without them, grading is still best-effort.
          </p>
        ) : null}
      </div>

      <Button
        onClick={submit}
        disabled={isDisabled}
        className={isDisabled ? "" : "shadow-sm ring-1 ring-accent/20"}
      >
        {loading ? "Generating questions..." : "Generate questions"}
      </Button>
      {selectedDocs.length === 0 && !loading ? (
        <p className="text-xs text-ink/60">
          To generate questions, select at least one study material.
        </p>
      ) : customStyleMissing && !loading ? (
        <p className="text-xs text-ink/60">
          Select a saved custom style or switch back to a built-in style before generating.
        </p>
      ) : null}
      {loading ? (
        <div className="space-y-1 rounded-md border border-ink/10 bg-ink/[0.02] p-3">
          <p className="text-sm text-ink/70">
            This can take a minute or two for higher-quality grounded questions.
          </p>
          <p className="text-xs text-ink/55">
            We build each question from your study material, then check it before it reaches your question bank.
          </p>
        </div>
      ) : null}
      {status ? <p className="text-xs text-ink/60">{status}</p> : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {summary ? (
        <div className="space-y-3 rounded-lg border border-accent/20 bg-accent/[0.05] p-4">
          <div className="space-y-1">
            {summary.passedCount > 0 ? (
              <p className="text-sm font-semibold text-ink">Your question bank has been updated.</p>
            ) : (
              <p className="text-sm font-semibold text-ink">No new questions were added.</p>
            )}
            {summary.failedCount > 0 ? (
              <p className="text-sm text-ink/70">
                {summary.passedCount === 0
                  ? describeGenerationFailure(summary.primaryFailureReason)
                  : "Some questions could not be generated because a clean grounded item could not be formed from the selected source. You can try again."}
              </p>
            ) : (
              <p className="text-sm text-ink/70">
                {summary.passedCount} {summary.passedCount === 1 ? "question is" : "questions are"} ready.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {summary.passedCount > 0 ? (
              <Button type="button" onClick={() => router.push("/dashboard/practice")}>
                Practise these questions
              </Button>
            ) : null}
            {summary.passedCount > 0 ? (
              <Button type="button" variant="outline" onClick={() => router.push("/dashboard/exam")}>
                Start a mock exam
              </Button>
            ) : null}
            <Button
              type="button"
              variant={summary.passedCount > 0 ? "outline" : "default"}
              onClick={() => {
                setSummary(null);
                setError(null);
                setStatus(null);
              }}
            >
              Generate more questions
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
