"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Question = {
  id: string;
  stem: string;
  type: "MCQ" | "SHORT_ANSWER";
  optionsJson?: string[];
};

type Feedback = {
  correct: boolean;
  needsReview: boolean;
  rationale: string;
  citations: { chunkId: string; excerpt: string; page?: number | null }[];
};

export function PracticeClient() {
  const [question, setQuestion] = useState<Question | null>(null);
  const [answer, setAnswer] = useState("");
  const [recycle, setRecycle] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number>(Date.now());

  const loadQuestion = async () => {
    setStatus("Loading question...");
    setFeedback(null);
    setAnswer("");
    const response = await fetch(`/api/practice/next?recycle=${recycle}`);
    const body = await response.json();
    setQuestion(body.question ?? null);
    setStatus(body.question ? null : body.message ?? "No questions available");
    setStartTime(Date.now());
  };

  useEffect(() => {
    async function syncQuestion() {
      setStatus("Loading question...");
      setFeedback(null);
      setAnswer("");
      const response = await fetch(`/api/practice/next?recycle=${recycle}`);
      const body = await response.json();
      setQuestion(body.question ?? null);
      setStatus(body.question ? null : body.message ?? "No questions available");
      setStartTime(Date.now());
    }

    void syncQuestion();
  }, [recycle]);

  const submit = async () => {
    if (!question) return;
    const timeSpentSec = Math.round((Date.now() - startTime) / 1000);
    const response = await fetch("/api/practice/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: question.id, answer, timeSpentSec })
    });
    const body = await response.json();
    setFeedback(body);
  };

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm text-ink/70">
        <input type="checkbox" checked={recycle} onChange={() => setRecycle(!recycle)} />
        Recycle due questions
      </label>

      {question ? (
        <div className="space-y-4">
          <div>
            <p className="text-lg font-medium text-ink">{question.stem}</p>
          </div>
          {question.type === "MCQ" ? (
            <div className="space-y-2">
              {(question.optionsJson ?? []).map((option) => (
                <label key={option} className="flex items-center gap-2 text-sm text-ink/70">
                  <input
                    type="radio"
                    name="mcq"
                    value={option}
                    checked={answer === option}
                    onChange={() => setAnswer(option)}
                  />
                  {option}
                </label>
              ))}
            </div>
          ) : (
            <Textarea value={answer} onChange={(event) => setAnswer(event.target.value)} />
          )}
          <Button onClick={submit} disabled={!answer}>
            Submit answer
          </Button>
        </div>
      ) : (
        <p className="text-sm text-ink/60">{status ?? "No question"}</p>
      )}

      {feedback ? (
        <div className="rounded-md border border-ink/10 bg-white p-4 text-sm">
          <p className={`font-medium ${feedback.correct ? "text-accent" : "text-danger"}`}>
            {feedback.needsReview ? "Needs review" : feedback.correct ? "Correct" : "Incorrect"}
          </p>
          <p className="mt-2 text-ink/70">{feedback.rationale}</p>
          <div className="mt-3 space-y-2">
            <p className="text-xs font-semibold uppercase text-ink/40">Citations</p>
            {feedback.citations?.map((citation) => (
              <p key={citation.chunkId} className="text-xs text-ink/60">
                {citation.excerpt}
              </p>
            ))}
          </div>
          <Button variant="outline" size="sm" className="mt-4" onClick={loadQuestion}>
            Next question
          </Button>
        </div>
      ) : null}
    </div>
  );
}
