"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type Doc = { id: string; title: string };
type Profile = { id: string; name: string };
type GenerationResult = { questionId?: string; status: string; reason?: string };

export function GenerateForm({ documents, profiles }: { documents: Doc[]; profiles: Profile[] }) {
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState(3);
  const [count, setCount] = useState(5);
  const [profileId, setProfileId] = useState<string | null>(profiles[0]?.id ?? null);

  const toggleDoc = (id: string) => {
    setSelectedDocs((prev) => (prev.includes(id) ? prev.filter((doc) => doc !== id) : [...prev, id]));
  };

  const submit = async () => {
    setLoading(true);
    setStatus("Generating questions...");
    try {
      const response = await fetch("/api/questions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentIds: selectedDocs,
          styleProfileId: profileId,
          difficulty,
          count
        })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setStatus(body.error ?? "Generation failed");
        return;
      }

      const body = await response.json().catch(() => ({}));
      const results = Array.isArray(body.results) ? (body.results as GenerationResult[]) : [];
      const passedCount = results.filter((result) => result.status === "PASSED").length;
      const insufficientEvidenceCount = results.filter(
        (result) => result.status === "INSUFFICIENT_EVIDENCE"
      ).length;
      const firstFailureReason =
        results.find((result) => result.status !== "PASSED" && result.reason)?.reason ?? null;

      setStatus(
        [
          `Generated ${passedCount} question(s).`,
          insufficientEvidenceCount > 0
            ? `${insufficientEvidenceCount} could not be created from the available material.`
            : "Your new questions are ready in Practice Questions and Mock Exam.",
          firstFailureReason ? `First issue: ${firstFailureReason}.` : null
        ]
          .filter(Boolean)
          .join(" ")
      );
    } catch {
      setStatus("Generation failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const isDisabled = selectedDocs.length === 0 || loading;

  return (
    <div className="space-y-4">
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
        <label className="text-sm font-medium text-ink">Question format</label>
        <p className="text-sm text-ink/60">Choose the format you want for the generated questions.</p>
        <select
          className="h-10 w-full rounded-md border border-ink/15 bg-white px-3 text-sm"
          value={profileId ?? ""}
          onChange={(event) => setProfileId(event.target.value || null)}
        >
          <option value="">Default style</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-ink">Question difficulty</label>
        <p className="text-sm text-ink/60">Choose how challenging you want the questions to be.</p>
        <input
          type="range"
          min={1}
          max={5}
          value={difficulty}
          onChange={(event) => setDifficulty(Number(event.target.value))}
          className="w-full"
        />
        <div className="space-y-1 text-sm text-ink/60">
          <p>1 Easy</p>
          <p>2 Moderate</p>
          <p>3 Standard exam level</p>
          <p>4 Challenging</p>
          <p>5 Very challenging</p>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-ink">Number of questions</label>
        <input
          type="number"
          min={1}
          max={20}
          value={count}
          onChange={(event) => setCount(Number(event.target.value))}
          className="h-10 w-full rounded-md border border-ink/15 bg-white px-3 text-sm"
        />
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
      ) : null}
      {loading ? (
        <p className="text-xs text-ink/60">
          This may take a little time while we build and check each question.
        </p>
      ) : null}
      {status ? <p className="text-xs text-ink/60">{status}</p> : null}
    </div>
  );
}
