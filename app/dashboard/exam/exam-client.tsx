"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getShortAnswerReviewLabel, type ShortAnswerReviewStatus } from "@/lib/feedback/user-facing";

type Question = {
  id: string;
  stem: string;
  type: "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE";
  options: string[];
};

type ReviewCitation = {
  label: string;
  excerpt: string;
};

type ExamReviewItem = {
  order: number;
  questionId: string;
  stem: string;
  type: "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE";
  userAnswer: string | null;
  correct: boolean;
  needsReview: boolean;
  reviewStatus: ShortAnswerReviewStatus | null;
  correctAnswer: string;
  rationale: string;
  citations: ReviewCitation[];
};

type ExamReview = {
  correct: number;
  total: number;
  needsReview: number;
  objectiveCorrect: number;
  objectiveTotal: number;
  shortAnswerReviewed: number;
  shortAnswerStrongMatch: number;
  shortAnswerPartialMatch: number;
  shortAnswerNeedsReview: number;
  review: ExamReviewItem[];
};

const difficultyOptions = [
  {
    label: "Easy",
    value: 2,
    description: "Straightforward recall and more obvious questions."
  },
  {
    label: "Moderate",
    value: 3,
    description: "Standard competency level."
  },
  {
    label: "Hard",
    value: 4,
    description: "Deeper mastery and more difficult distinctions."
  }
] as const;

export function ExamClient() {
  const [count, setCount] = useState(10);
  const [timeLimitMin, setTimeLimitMin] = useState(30);
  const [difficulty, setDifficulty] = useState<number>(3);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [timer, setTimer] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [review, setReview] = useState<ExamReview | null>(null);

  useEffect(() => {
    if (!timer) return;
    const interval = setInterval(() => {
      setTimer((prev) => (prev ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [timer]);

  async function submitExam(activeSessionId: string, answerMap: Record<string, string>) {
    setStatus("Submitting exam...");
    const answerList = Object.entries(answerMap).map(([questionId, selectedAnswer]) => ({
      questionId,
      selectedAnswer
    }));

    const response = await fetch("/api/exam/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: activeSessionId, answers: answerList })
    });

    const body = await response.json();
    if (!response.ok) {
      setStatus(body.error ?? "Failed to submit exam");
      return;
    }

    setReview(body);
    setStatus(null);
    setSessionId(null);
    setQuestions([]);
    setTimer(null);
  }

  useEffect(() => {
    if (timer !== 0 || !sessionId) return;
    void submitExam(sessionId, answers);
  }, [answers, sessionId, timer]);

  const startExam = async () => {
    setStatus("Starting exam...");
    setReview(null);

    const response = await fetch("/api/exam/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        count,
        timeLimitMin,
        difficulty
      })
    });

    const body = await response.json();
    if (!response.ok) {
      setStatus(
        body.error === "No questions available"
          ? "No questions available for a mock exam yet. Generate questions first."
          : body.error ?? "Unable to start mock exam"
      );
      return;
    }

    setSessionId(body.sessionId);
    setQuestions(body.questions);
    setAnswers({});
    setTimer(body.timeLimitMin * 60);
    setStatus(null);
  };

  const finishExam = async () => {
    if (!sessionId) return;
    await submitExam(sessionId, answers);
  };

  const resetReview = () => {
    setReview(null);
    setStatus(null);
  };

  const formatTimer = () => {
    if (timer === null) return "";
    const min = Math.floor(timer / 60);
    const sec = timer % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-4">
      {review ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-ink/10 bg-white p-5 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
            <p className="text-lg font-medium text-ink">Exam review</p>
            <p className="mt-2 text-sm text-ink/70">
              Objective score: {review.objectiveCorrect}/{review.objectiveTotal}
            </p>
            <div className="mt-2 space-y-1 text-sm text-ink/60">
              <p>Short-answer reviewed: {review.shortAnswerReviewed}</p>
              <p>Strong match: {review.shortAnswerStrongMatch}</p>
              <p>Partial match: {review.shortAnswerPartialMatch}</p>
              <p>Needs review: {review.shortAnswerNeedsReview}</p>
            </div>
            <Button className="mt-4" onClick={resetReview}>
              Start another mock exam
            </Button>
          </div>

          {review.review.map((item) => {
            const isShortAnswer = item.type === "SHORT_ANSWER";
            const statusLabel = isShortAnswer
              ? getShortAnswerReviewLabel(item.reviewStatus) ?? "Short-answer review"
              : item.correct
                ? "Correct"
                : "Incorrect";
            const statusClass = isShortAnswer
              ? item.reviewStatus === "STRONG_MATCH"
                ? "text-accent"
                : item.reviewStatus === "PARTIAL_MATCH"
                  ? "text-danger"
                  : "text-ink"
              : item.correct
                ? "text-accent"
                : "text-danger";

            return (
              <div key={item.questionId} className="space-y-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-[0_18px_35px_-34px_rgba(15,23,42,0.45)]">
                <div className="space-y-1">
                  <p className="text-sm text-ink/50">Question {item.order}</p>
                  <p className="font-medium text-ink">{item.stem}</p>
                </div>

                <p className={`inline-flex rounded-full bg-ink/[0.03] px-3 py-1 text-sm font-medium ${statusClass}`}>
                  {statusLabel}
                </p>
                <p className="text-sm text-ink/70">
                  <span className="font-medium text-ink">Your answer:</span>{" "}
                  {item.userAnswer?.trim() ? item.userAnswer : "No answer submitted"}
                </p>
                <p className="text-sm text-ink/70">
                  <span className="font-medium text-ink">
                    {isShortAnswer ? "Model answer:" : "Correct answer:"}
                  </span>{" "}
                  {item.correctAnswer}
                </p>
                <p className="text-sm text-ink/70">{item.rationale}</p>
                {isShortAnswer ? (
                  <p className="text-sm text-ink/60">
                    This is a model-answer review rather than an objective score.
                  </p>
                ) : null}

                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase text-ink/40">Citations</p>
                  {item.citations.length > 0 ? (
                    item.citations.map((citation, index) => (
                      <div
                        key={`${item.questionId}-${citation.label}-${index}`}
                        className="space-y-1 rounded-xl border border-ink/10 bg-ink/[0.02] p-3"
                      >
                        <p className="text-xs font-medium text-ink/50">{citation.label}</p>
                        <p className="text-xs text-ink/60">{citation.excerpt}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-ink/50">No source excerpt available.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : !sessionId ? (
        <div className="space-y-4">
          <div className="grid gap-4 text-sm md:grid-cols-2">
            <label className="flex items-center justify-between rounded-2xl border border-ink/10 bg-ink/[0.02] px-4 py-3">
              <span className="font-medium text-ink">Number of questions</span>
              <input
                type="number"
                min={1}
                max={50}
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
                className="h-9 w-24 rounded-md border border-ink/15 px-2"
              />
            </label>
            <label className="flex items-center justify-between rounded-2xl border border-ink/10 bg-ink/[0.02] px-4 py-3">
              <span className="font-medium text-ink">Time limit (min)</span>
              <input
                type="number"
                min={5}
                max={180}
                value={timeLimitMin}
                onChange={(event) => setTimeLimitMin(Number(event.target.value))}
                className="h-9 w-24 rounded-md border border-ink/15 px-2"
              />
            </label>
            <div className="space-y-3 rounded-2xl border border-ink/10 bg-ink/[0.02] p-4 md:col-span-2">
              <div className="space-y-1">
                <p className="font-medium text-ink">Difficulty</p>
                <p className="text-xs text-ink/55">Choose the overall challenge level for this exam.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {difficultyOptions.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant={difficulty === option.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setDifficulty(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              <div className="space-y-1 text-xs text-ink/60">
                {difficultyOptions.map((option) => (
                  <p key={option.value}>
                    <span className="font-medium text-ink">{option.label}</span> = {option.description}
                  </p>
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-accent/20 bg-accentSoft/40 p-4">
            <p className="text-sm font-medium text-ink">Short-answer grading note</p>
            <p className="mt-1 text-sm text-ink/65">
              If your exam includes short-answer questions, feedback is strongest when the underlying
              question format included marking guides, model answers, or rubrics.
            </p>
          </div>
          <Button onClick={startExam} className="shadow-sm">Start mock exam</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-ink/10 bg-ink/[0.02] px-4 py-3">
            <p className="text-sm text-ink/60">Time remaining: {formatTimer()}</p>
          </div>
          {questions.map((question, index) => (
            <div key={question.id} className="space-y-2 rounded-2xl border border-ink/10 bg-white p-4 shadow-[0_18px_35px_-34px_rgba(15,23,42,0.45)]">
              <p className="text-sm font-medium text-ink">
                {index + 1}. {question.stem}
              </p>
              {question.type === "MCQ" || question.type === "TRUE_FALSE" ? (
                <div className="space-y-2">
                  {question.options.map((option) => (
                    <label key={option} className="flex items-center gap-2 text-sm text-ink/70">
                      <input
                        type="radio"
                        name={question.id}
                        checked={answers[question.id] === option}
                        onChange={() => setAnswers((prev) => ({ ...prev, [question.id]: option }))}
                      />
                      {option}
                    </label>
                  ))}
                </div>
              ) : (
                <Textarea
                  value={answers[question.id] ?? ""}
                  onChange={(event) =>
                    setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))
                  }
                />
              )}
            </div>
          ))}
          <Button onClick={finishExam} className="shadow-sm">Submit mock exam</Button>
        </div>
      )}

      {status ? <p className="text-sm text-ink/60">{status}</p> : null}
    </div>
  );
}
