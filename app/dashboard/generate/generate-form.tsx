"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type Doc = { id: string; title: string };
type Profile = { id: string; name: string };

export function GenerateForm({ documents, profiles }: { documents: Doc[]; profiles: Profile[] }) {
  const [status, setStatus] = useState<string | null>(null);
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState(3);
  const [count, setCount] = useState(5);
  const [profileId, setProfileId] = useState<string | null>(profiles[0]?.id ?? null);

  const toggleDoc = (id: string) => {
    setSelectedDocs((prev) => (prev.includes(id) ? prev.filter((doc) => doc !== id) : [...prev, id]));
  };

  const submit = async () => {
    setStatus("Generating...");
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
    setStatus(`Generated: ${body.results?.length ?? 0} results`);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">Select documents</p>
        {documents.length === 0 ? (
          <p className="text-sm text-ink/60">No ready documents available.</p>
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
        <label className="text-sm font-medium text-ink">Style profile</label>
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
        <label className="text-sm font-medium text-ink">Difficulty: {difficulty}</label>
        <input
          type="range"
          min={1}
          max={5}
          value={difficulty}
          onChange={(event) => setDifficulty(Number(event.target.value))}
          className="w-full"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-ink">Question count</label>
        <input
          type="number"
          min={1}
          max={20}
          value={count}
          onChange={(event) => setCount(Number(event.target.value))}
          className="h-10 w-full rounded-md border border-ink/15 bg-white px-3 text-sm"
        />
      </div>

      <Button onClick={submit} disabled={selectedDocs.length === 0}>
        Generate questions
      </Button>
      {status ? <p className="text-xs text-ink/60">{status}</p> : null}
    </div>
  );
}
