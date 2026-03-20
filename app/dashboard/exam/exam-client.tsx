"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Question = {
  id: string;
  stem: string;
  type: "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE";
  options: string[];
};

export function ExamClient() {
  const [count, setCount] = useState(10);
  const [timeLimitMin, setTimeLimitMin] = useState(30);
  const [difficulty, setDifficulty] = useState<number | "">("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [timer, setTimer] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!timer) return;
    const interval = setInterval(() => {
      setTimer((prev) => (prev ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [timer]);

  useEffect(() => {
    if (timer !== 0 || !sessionId) return;

    async function submitExpiredExam() {
      setStatus("Submitting exam...");
      const answerList = Object.entries(answers).map(([questionId, selectedAnswer]) => ({
        questionId,
        selectedAnswer
      }));

      const response = await fetch("/api/exam/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, answers: answerList })
      });

      const body = await response.json();
      if (!response.ok) {
        setStatus(body.error ?? "Failed to submit exam");
        return;
      }

      setStatus(`Score: ${body.correct}/${body.total}`);
      setSessionId(null);
      setQuestions([]);
      setTimer(null);
    }

    void submitExpiredExam();
  }, [answers, sessionId, timer]);

  const startExam = async () => {
    setStatus("Starting exam...");
    const response = await fetch("/api/exam/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        count,
        timeLimitMin,
        difficulty: difficulty === "" ? null : Number(difficulty)
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
    setStatus("Submitting exam...");
    const answerList = Object.entries(answers).map(([questionId, selectedAnswer]) => ({
      questionId,
      selectedAnswer
    }));

    const response = await fetch("/api/exam/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, answers: answerList })
    });

    const body = await response.json();
    if (!response.ok) {
      setStatus(body.error ?? "Failed to submit exam");
      return;
    }

    setStatus(`Score: ${body.correct}/${body.total}`);
    setSessionId(null);
    setQuestions([]);
    setTimer(null);
  };

  const formatTimer = () => {
    if (timer === null) return "";
    const min = Math.floor(timer / 60);
    const sec = timer % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-4">
      {!sessionId ? (
        <div className="space-y-3">
          <div className="grid gap-2 text-sm">
            <label className="flex items-center justify-between">
              Question count
              <input
                type="number"
                min={1}
                max={50}
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
                className="h-9 w-24 rounded-md border border-ink/15 px-2"
              />
            </label>
            <label className="flex items-center justify-between">
              Time limit (min)
              <input
                type="number"
                min={5}
                max={180}
                value={timeLimitMin}
                onChange={(event) => setTimeLimitMin(Number(event.target.value))}
                className="h-9 w-24 rounded-md border border-ink/15 px-2"
              />
            </label>
            <label className="flex items-center justify-between">
              Difficulty (optional)
              <input
                type="number"
                min={1}
                max={5}
                value={difficulty}
                onChange={(event) => setDifficulty(event.target.value === "" ? "" : Number(event.target.value))}
                className="h-9 w-24 rounded-md border border-ink/15 px-2"
              />
            </label>
          </div>
          <Button onClick={startExam}>Start mock exam</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink/60">Time remaining: {formatTimer()}</p>
          {questions.map((question, index) => (
            <div key={question.id} className="space-y-2 rounded-md border border-ink/10 p-3">
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
          <Button onClick={finishExam}>Submit mock exam</Button>
        </div>
      )}

      {status ? <p className="text-sm text-ink/60">{status}</p> : null}
    </div>
  );
}
