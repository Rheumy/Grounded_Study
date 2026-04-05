"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Doc = { id: string; title: string };
type QuestionType = "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE";
type QuestionTypeMode = "SINGLE" | "MIXED";
type Profile = {
  id: string;
  name: string;
  distribution: { MCQ?: number; SHORT_ANSWER?: number; TRUE_FALSE?: number } | null;
};
type GenerationResult = { questionId?: string; status: string; reason?: string };

function inferTypeCounts(
  count: number,
  distribution: { MCQ?: number; SHORT_ANSWER?: number; TRUE_FALSE?: number } | null
): { MCQ: number; SHORT_ANSWER: number; TRUE_FALSE: number } {
  if (!distribution) return { MCQ: count, SHORT_ANSWER: 0, TRUE_FALSE: 0 };

  const mcqW = distribution.MCQ ?? 0;
  const saW = distribution.SHORT_ANSWER ?? 0;
  const tfW = distribution.TRUE_FALSE ?? 0;
  const totalWeight = mcqW + saW + tfW;

  if (totalWeight === 0) return { MCQ: count, SHORT_ANSWER: 0, TRUE_FALSE: 0 };

  const mcq = Math.round(count * (mcqW / totalWeight));
  const sa = Math.round(count * (saW / totalWeight));
  const tf = Math.max(0, count - mcq - sa);
  return { MCQ: mcq, SHORT_ANSWER: sa, TRUE_FALSE: tf };
}

function getDominantType(
  distribution: { MCQ?: number; SHORT_ANSWER?: number; TRUE_FALSE?: number } | null
): QuestionType {
  if (!distribution) return "MCQ";

  const entries: Array<[QuestionType, number]> = [
    ["MCQ", distribution.MCQ ?? 0],
    ["SHORT_ANSWER", distribution.SHORT_ANSWER ?? 0],
    ["TRUE_FALSE", distribution.TRUE_FALSE ?? 0]
  ];

  return entries.sort((a, b) => b[1] - a[1])[0]?.[0] ?? "MCQ";
}

export function GenerateForm({ documents, profiles }: { documents: Doc[]; profiles: Profile[] }) {
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState(3);
  const [count, setCount] = useState(5);
  const [profileId, setProfileId] = useState<string | null>(profiles[0]?.id ?? null);
  const [questionTypeMode, setQuestionTypeMode] = useState<QuestionTypeMode>("SINGLE");
  const [singleType, setSingleType] = useState<QuestionType>("MCQ");
  const [mcqCount, setMcqCount] = useState(5);
  const [shortAnswerCount, setShortAnswerCount] = useState(0);
  const [trueFalseCount, setTrueFalseCount] = useState(0);

  const toggleDoc = (id: string) => {
    setSelectedDocs((prev) =>
      prev.includes(id) ? prev.filter((doc) => doc !== id) : [...prev, id]
    );
  };

  useEffect(() => {
    const profile = profiles.find((p) => p.id === profileId) ?? null;
    const inferred = inferTypeCounts(count, profile?.distribution ?? null);

    if (questionTypeMode === "MIXED") {
      setMcqCount(inferred.MCQ);
      setShortAnswerCount(inferred.SHORT_ANSWER);
      setTrueFalseCount(inferred.TRUE_FALSE);
      return;
    }

    setSingleType(getDominantType(profile?.distribution ?? null));
  }, [count, profileId, profiles, questionTypeMode]);

  const typeMixTotal = mcqCount + shortAnswerCount + trueFalseCount;
  const typeMixMismatch = questionTypeMode === "MIXED" && typeMixTotal !== count;
  const shortAnswerGuidanceVisible =
    questionTypeMode === "SINGLE"
      ? singleType === "SHORT_ANSWER"
      : shortAnswerCount > 0;

  const submit = async () => {
    setLoading(true);
    setStatus("Generating questions...");
    try {
      const typeMix =
        questionTypeMode === "SINGLE"
          ? {
              MCQ: singleType === "MCQ" ? count : 0,
              SHORT_ANSWER: singleType === "SHORT_ANSWER" ? count : 0,
              TRUE_FALSE: singleType === "TRUE_FALSE" ? count : 0
            }
          : { MCQ: mcqCount, SHORT_ANSWER: shortAnswerCount, TRUE_FALSE: trueFalseCount };

      const response = await fetch("/api/questions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentIds: selectedDocs,
          styleProfileId: profileId,
          difficulty,
          count,
          typeMix
        })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setStatus(body.error ?? "Generation failed");
        return;
      }

      const body = await response.json().catch(() => ({}));
      const results = Array.isArray(body.results) ? (body.results as GenerationResult[]) : [];
      const passedCount = results.filter((r) => r.status === "PASSED").length;
      const insufficientCount = results.filter(
        (r) => r.status === "INSUFFICIENT_EVIDENCE"
      ).length;
      const firstFailureReason =
        results.find((r) => r.status !== "PASSED" && r.reason)?.reason ?? null;

      setStatus(
        [
          `Generated ${passedCount} question(s).`,
          insufficientCount > 0
            ? `${insufficientCount} could not be created from the available material.`
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

  const isDisabled = selectedDocs.length === 0 || loading || typeMixMismatch;

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

      <div className="space-y-2 rounded-md border border-ink/10 bg-ink/[0.02] p-4">
        <label className="text-sm font-medium text-ink">Question format</label>
        <p className="text-sm text-ink/60">
          Question Format shapes wording, answer expectations, and exam flavour. The question type
          controls below decide what gets generated in this run.
        </p>
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
        <p className="text-xs text-ink/55">
          Current MCQ generation uses exactly 4 options, even if a saved format suggests a different
          option count.
        </p>
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

      <div className="space-y-3 rounded-md border border-ink/10 bg-ink/[0.02] p-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink">Question type for this run</p>
          <p className="text-xs text-ink/60">
            This control decides which question types to generate right now.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={questionTypeMode === "SINGLE" ? "default" : "outline"}
            size="sm"
            onClick={() => setQuestionTypeMode("SINGLE")}
          >
            Single type
          </Button>
          <Button
            type="button"
            variant={questionTypeMode === "MIXED" ? "default" : "outline"}
            size="sm"
            onClick={() => setQuestionTypeMode("MIXED")}
          >
            Mixed types
          </Button>
        </div>

        {questionTypeMode === "SINGLE" ? (
          <div className="space-y-2">
            <p className="text-xs text-ink/60">
              Generate one question type only for this run.
            </p>
            <select
              className="h-10 w-full rounded-md border border-ink/15 bg-white px-3 text-sm"
              value={singleType}
              onChange={(event) => setSingleType(event.target.value as QuestionType)}
            >
              <option value="MCQ">MCQ</option>
              <option value="TRUE_FALSE">True / False</option>
              <option value="SHORT_ANSWER">Short answer</option>
            </select>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-ink/60">
              Choose the mix for this run. {profileId ? "The counts below are a starting suggestion from your selected Question Format." : "By default this starts as all MCQ."}
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="space-y-1 text-xs text-ink/70">
                <span>Multiple choice (MCQ)</span>
                <input
                  type="number"
                  min={0}
                  max={count}
                  value={mcqCount}
                  onChange={(event) => setMcqCount(Math.max(0, Number(event.target.value)))}
                  className="h-9 w-full rounded-md border border-ink/15 bg-white px-2 text-sm"
                />
              </label>
              <label className="space-y-1 text-xs text-ink/70">
                <span>Short answer</span>
                <input
                  type="number"
                  min={0}
                  max={count}
                  value={shortAnswerCount}
                  onChange={(event) => setShortAnswerCount(Math.max(0, Number(event.target.value)))}
                  className="h-9 w-full rounded-md border border-ink/15 bg-white px-2 text-sm"
                />
              </label>
              <label className="space-y-1 text-xs text-ink/70">
                <span>True / False</span>
                <input
                  type="number"
                  min={0}
                  max={count}
                  value={trueFalseCount}
                  onChange={(event) => setTrueFalseCount(Math.max(0, Number(event.target.value)))}
                  className="h-9 w-full rounded-md border border-ink/15 bg-white px-2 text-sm"
                />
              </label>
            </div>
            <p className={`text-xs ${typeMixMismatch ? "text-danger font-medium" : "text-ink/50"}`}>
              Total: {typeMixTotal} / {count}
              {typeMixMismatch ? " — total must match the number of questions" : ""}
            </p>
          </div>
        )}

        <p className="text-xs text-ink/55">
          Question Format influences style. Question type mode controls the types generated in this run.
        </p>
        {shortAnswerGuidanceVisible ? (
          <p className="text-xs text-ink/55">
            Short-answer feedback is strongest when your question format includes model answers,
            marking guides, or rubrics. Without them, grading is still best-effort.
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
