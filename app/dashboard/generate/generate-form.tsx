"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
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
type GenerationSummary = {
  requestedCount: number;
  passedCount: number;
  failedCount: number;
};

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
  const [questionTypeMode, setQuestionTypeMode] = useState<QuestionTypeMode>("SINGLE");
  const [singleType, setSingleType] = useState<QuestionType>("MCQ");
  const [mcqCount, setMcqCount] = useState(5);
  const [shortAnswerCount, setShortAnswerCount] = useState(0);
  const [trueFalseCount, setTrueFalseCount] = useState(0);
  const [selectedStyleProfileId, setSelectedStyleProfileId] = useState<string>("");

  const toggleDoc = (id: string) => {
    setSelectedDocs((prev) =>
      prev.includes(id) ? prev.filter((doc) => doc !== id) : [...prev, id]
    );
  };

  const typeMixTotal = mcqCount + shortAnswerCount + trueFalseCount;
  const typeMixMismatch = questionTypeMode === "MIXED" && typeMixTotal !== count;
  const shortAnswerGuidanceVisible =
    questionTypeMode === "SINGLE"
      ? singleType === "SHORT_ANSWER"
      : shortAnswerCount > 0;

  const submit = async () => {
    setError(null);
    setSummary(null);
    setLoading(true);
    setStatus("Your questions are being built from your study material.");
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
          styleProfileId: selectedStyleProfileId || null,
          difficulty,
          count,
          typeMix
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

      setSummary({
        requestedCount: body.summary?.requestedCount ?? count,
        passedCount,
        failedCount
      });
      setStatus(null);
    } catch {
      setError("Generation failed. Please try again.");
      setStatus(null);
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
        <label className="text-sm font-medium text-ink">Question Style</label>
        <div className="space-y-2 rounded-md border border-ink/10 bg-ink/[0.02] p-4">
          <p className="text-xs text-ink/60">
            Question Style shapes wording, depth, and explanation tone. Question type below controls
            whether this run generates MCQ, True / False, or Short answer.
          </p>
          {profiles.length > 0 ? (
            <select
              className="h-10 w-full rounded-md border border-ink/15 bg-white px-3 text-sm"
              value={selectedStyleProfileId}
              onChange={(event) => setSelectedStyleProfileId(event.target.value)}
            >
              <option value="">No saved question style</option>
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

            if (questionTypeMode === "MIXED" && shortAnswerCount === 0 && trueFalseCount === 0) {
              setMcqCount(nextCount);
            }
          }}
          className="h-10 w-full rounded-md border border-ink/15 bg-white px-3 text-sm"
        />
        <p className="text-xs text-ink/55">You can create up to {maxRequestCount} questions in one run.</p>
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
            onClick={() => {
              setQuestionTypeMode("MIXED");
              setMcqCount(count);
              setShortAnswerCount(0);
              setTrueFalseCount(0);
            }}
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
              Choose the mix for this run. By default this starts as all MCQ.
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
          Question type mode controls the types generated in this run. Current MCQ generation uses
          exactly 4 options.
        </p>
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
                Some questions could not be generated because there was insufficient evidence or
                the model response was invalid. You can try again.
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
