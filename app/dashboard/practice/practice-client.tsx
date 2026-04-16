"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getShortAnswerReviewLabel, type ShortAnswerReviewStatus } from "@/lib/feedback/user-facing";

type QuestionType = "MCQ" | "SHORT_ANSWER" | "TRUE_FALSE";
type QuestionTypeFilter = QuestionType | "ALL";
type RecycleMode = "NONE" | "DUE" | "INCORRECT" | "ALL";
type QuestionFeedbackLabel = "EASY" | "HARD" | "DISPUTED_INCORRECT";

type QuestionFeedback = {
  label: QuestionFeedbackLabel;
  comment: string | null;
};

type Question = {
  id: string;
  stem: string;
  type: QuestionType;
  optionsJson?: string[] | null;
  tagsJson?: unknown;
  userFeedback: QuestionFeedback | null;
};

type FeedbackCitation = {
  label: string;
  excerpt: string;
};

type Feedback = {
  attemptId: string;
  correct: boolean;
  needsReview: boolean;
  reviewStatus: ShortAnswerReviewStatus | null;
  correctAnswer: string;
  rationale: string;
  citations: FeedbackCitation[];
  userFeedback: QuestionFeedback | null;
};

type PracticeSessionConfig = {
  questionType: QuestionTypeFilter;
  sessionLength: number;
  recycleMode: RecycleMode;
};

type AnsweredQuestion = {
  question: Question;
  answer: string;
  feedback: Feedback;
};

function normalizeSessionLength(value: number): number {
  if (!Number.isFinite(value)) return 5;
  return Math.min(50, Math.max(1, Math.round(value)));
}

function parseTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

const recycleModeDescriptions: Record<RecycleMode, string> = {
  NONE: "Stay with questions you have never answered before in practice or a mock exam.",
  DUE: "Mix in questions that are scheduled to come back for revision.",
  INCORRECT: "Revisit questions you previously got wrong in practice or a mock exam.",
  ALL: "Use the full question pool, including fresh questions and ones you have seen before."
};

const questionFeedbackOptions: { label: string; value: QuestionFeedbackLabel }[] = [
  { label: "Easy", value: "EASY" },
  { label: "Hard", value: "HARD" },
  { label: "Incorrect question", value: "DISPUTED_INCORRECT" }
];

function getQuestionFeedbackLabel(label: QuestionFeedbackLabel | null): string | null {
  if (label === "EASY") return "Easy";
  if (label === "HARD") return "Hard";
  if (label === "DISPUTED_INCORRECT") return "Incorrect question";
  return null;
}

export function PracticeClient() {
  const [view, setView] = useState<"setup" | "active" | "summary">("setup");
  const [sessionConfig, setSessionConfig] = useState<PracticeSessionConfig>({
    questionType: "ALL",
    sessionLength: 5,
    recycleMode: "NONE"
  });
  const [question, setQuestion] = useState<Question | null>(null);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [results, setResults] = useState<AnsweredQuestion[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number>(Date.now());
  const [servedQuestionIds, setServedQuestionIds] = useState<string[]>([]);
  const [questionFeedback, setQuestionFeedback] = useState<QuestionFeedback | null>(null);
  const [questionFeedbackStatus, setQuestionFeedbackStatus] = useState<string | null>(null);
  const [questionFeedbackAttemptId, setQuestionFeedbackAttemptId] = useState<string | null>(null);
  const [isSavingQuestionFeedback, setIsSavingQuestionFeedback] = useState(false);

  const currentQuestionNumber = results.length + (question ? 1 : 0);
  const isShortAnswer = question?.type === "SHORT_ANSWER";
  const shortAnswerReviewLabel = getShortAnswerReviewLabel(feedback?.reviewStatus ?? null);
  const isCorrect = feedback?.correct === true;
  const feedbackStatus = isShortAnswer
    ? shortAnswerReviewLabel ?? "Short-answer review"
    : isCorrect
      ? "Correct"
      : "Incorrect";
  const feedbackStatusClass = isShortAnswer
    ? feedback?.reviewStatus === "STRONG_MATCH"
      ? "text-accent"
      : feedback?.reviewStatus === "PARTIAL_MATCH"
        ? "text-danger"
        : "text-ink"
    : isCorrect
      ? "text-accent"
      : "text-danger";

  const loadQuestion = async (excludeQuestionIds: string[], nextViewIfEmpty: "setup" | "summary") => {
    setStatus("Loading question...");
    setFeedback(null);
    setAnswer("");
    setQuestionFeedback(null);
    setQuestionFeedbackStatus(null);
    setQuestionFeedbackAttemptId(null);

    const params = new URLSearchParams({
      questionType: sessionConfig.questionType,
      recycleMode: sessionConfig.recycleMode
    });

    excludeQuestionIds.forEach((questionId) => params.append("excludeQuestionId", questionId));

    const response = await fetch(`/api/practice/next?${params.toString()}`);
    const body = await response.json();

    if (!response.ok) {
      setQuestion(null);
      setStatus(body.error ?? "Unable to load a practice question.");
      setQuestionFeedback(null);
      setQuestionFeedbackAttemptId(null);
      setView(nextViewIfEmpty);
      return;
    }

    setQuestion(body.question ?? null);
    setStatus(body.question ? null : body.message ?? "No questions available");
    setStartTime(Date.now());
    setQuestionFeedback(body.question?.userFeedback ?? null);
    setQuestionFeedbackAttemptId(null);

    if (body.question?.id) {
      setServedQuestionIds((prev) =>
        prev.includes(body.question.id) ? prev : [...prev, body.question.id]
      );
    }

    if (!body.question) {
      setView(nextViewIfEmpty);
    }
  };

  const startSession = async () => {
    setResults([]);
    setStatus(null);
    setServedQuestionIds([]);
    setQuestionFeedback(null);
    setQuestionFeedbackStatus(null);
    setQuestionFeedbackAttemptId(null);
    setView("active");
    await loadQuestion([], "setup");
  };

  const resetSession = () => {
    setView("setup");
    setQuestion(null);
    setAnswer("");
    setFeedback(null);
    setResults([]);
    setStatus(null);
    setStartTime(Date.now());
    setServedQuestionIds([]);
    setQuestionFeedback(null);
    setQuestionFeedbackStatus(null);
    setQuestionFeedbackAttemptId(null);
  };

  const endSession = () => {
    setQuestion(null);
    setAnswer("");
    setFeedback(null);
    setView(results.length > 0 ? "summary" : "setup");
    setStatus(results.length > 0 ? null : status);
  };

  const submit = async () => {
    if (!question) return;

    const submittedQuestion = question;
    const submittedAnswer = answer;
    const timeSpentSec = Math.round((Date.now() - startTime) / 1000);

    const response = await fetch("/api/practice/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: submittedQuestion.id, answer: submittedAnswer, timeSpentSec })
    });

    const body = await response.json();
    if (!response.ok) {
      setStatus(body.error ?? "Unable to submit your answer.");
      return;
    }

    setFeedback(body);
    setResults((prev) => [
      ...prev,
      {
        question: submittedQuestion,
        answer: submittedAnswer,
        feedback: body
      }
    ]);
    setQuestionFeedback(body.userFeedback ?? submittedQuestion.userFeedback ?? null);
    setQuestionFeedbackAttemptId(body.attemptId ?? null);
    setQuestionFeedbackStatus(null);
  };

  const moveToNextQuestion = async () => {
    if (results.length >= sessionConfig.sessionLength) {
      setQuestion(null);
      setAnswer("");
      setFeedback(null);
      setView("summary");
      return;
    }

    await loadQuestion(servedQuestionIds, "summary");
  };

  const saveQuestionFeedback = async (label: QuestionFeedbackLabel) => {
    if (!question || !feedback) return;

    setIsSavingQuestionFeedback(true);
    setQuestionFeedbackStatus("Saving your feedback...");

    const response = await fetch("/api/practice/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionId: question.id,
        attemptId: questionFeedbackAttemptId ?? feedback.attemptId,
        label
      })
    });

    const body = await response.json();

    if (!response.ok) {
      setQuestionFeedbackStatus(body.error ?? "Unable to save your feedback right now.");
      setIsSavingQuestionFeedback(false);
      return;
    }

    setQuestionFeedback(body.feedback ?? { label, comment: null });
    setQuestionFeedbackStatus(
      `Saved as ${getQuestionFeedbackLabel(body.feedback?.label ?? label) ?? "feedback"}.`
    );
    setIsSavingQuestionFeedback(false);
  };

  const totalAnswered = results.length;
  const objectiveResults = results.filter((item) => item.question.type !== "SHORT_ANSWER");
  const shortAnswerResults = results.filter((item) => item.question.type === "SHORT_ANSWER");
  const objectiveTotal = objectiveResults.length;
  const objectiveCorrect = objectiveResults.filter((item) => item.feedback.correct).length;
  const objectiveIncorrect = objectiveTotal - objectiveCorrect;
  const shortAnswerReviewed = shortAnswerResults.filter((item) => item.feedback.reviewStatus !== null).length;
  const shortAnswerStrongMatch = shortAnswerResults.filter(
    (item) => item.feedback.reviewStatus === "STRONG_MATCH"
  ).length;
  const shortAnswerPartialMatch = shortAnswerResults.filter(
    (item) => item.feedback.reviewStatus === "PARTIAL_MATCH"
  ).length;
  const shortAnswerNeedsReview = shortAnswerResults.filter(
    (item) => item.feedback.reviewStatus === "NEEDS_REVIEW"
  ).length;

  const incorrectTopicCounts = results.reduce<Record<string, number>>((acc, item) => {
    if (item.feedback.correct) return acc;

    for (const tag of parseTags(item.question.tagsJson)) {
      acc[tag] = (acc[tag] ?? 0) + 1;
    }

    return acc;
  }, {});

  const topIncorrectTopic = Object.entries(incorrectTopicCounts).sort((a, b) => b[1] - a[1])[0] ?? null;

  return (
    <div className="space-y-4">
      {view === "setup" ? (
        <div className="space-y-4">
          <div className="grid gap-4 text-sm md:grid-cols-2">
            <label className="grid gap-2 rounded-2xl border border-ink/10 bg-ink/[0.02] p-4">
              <span className="font-medium text-ink">Question type</span>
              <span className="text-xs text-ink/55">Choose one question type or practise a mixed set.</span>
              <select
                value={sessionConfig.questionType}
                onChange={(event) =>
                  setSessionConfig((prev) => ({
                    ...prev,
                    questionType: event.target.value as QuestionTypeFilter
                  }))
                }
                className="h-10 rounded-md border border-ink/15 bg-white px-3 text-ink"
              >
                <option value="ALL">All supported types</option>
                <option value="MCQ">MCQ</option>
                <option value="TRUE_FALSE">True/false</option>
                <option value="SHORT_ANSWER">Short answer</option>
              </select>
            </label>

            <div className="grid gap-2 rounded-2xl border border-ink/10 bg-ink/[0.02] p-4">
              <span className="font-medium text-ink">Questions this session</span>
              <span className="text-xs text-ink/55">Set how many questions you want to work through.</span>
              <div className="flex flex-wrap gap-2">
                {[5, 10, 20].map((length) => (
                  <Button
                    key={length}
                    type="button"
                    variant={sessionConfig.sessionLength === length ? "default" : "outline"}
                    size="sm"
                    onClick={() =>
                      setSessionConfig((prev) => ({
                        ...prev,
                        sessionLength: length
                      }))
                    }
                  >
                    {length}
                  </Button>
                ))}
              </div>
              <input
                type="number"
                min={1}
                max={50}
                value={sessionConfig.sessionLength}
                onChange={(event) =>
                  setSessionConfig((prev) => ({
                    ...prev,
                    sessionLength: normalizeSessionLength(Number(event.target.value))
                  }))
                }
                className="h-10 w-28 rounded-md border border-ink/15 px-3 text-ink"
              />
            </div>

            <label className="grid gap-2 rounded-2xl border border-ink/10 bg-ink/[0.02] p-4 md:col-span-2">
              <span className="font-medium text-ink">Question source</span>
              <span className="text-xs text-ink/55">
                Choose whether to stay with fresh questions, revisit past mistakes, or draw from
                everything available.
              </span>
              <select
                value={sessionConfig.recycleMode}
                onChange={(event) =>
                  setSessionConfig((prev) => ({
                    ...prev,
                    recycleMode: event.target.value as RecycleMode
                  }))
                }
                className="h-10 rounded-md border border-ink/15 bg-white px-3 text-ink"
              >
                <option value="NONE">New questions</option>
                <option value="INCORRECT">Prior incorrect questions</option>
                <option value="ALL">All questions</option>
              </select>
              <p className="text-xs text-ink/55">{recycleModeDescriptions[sessionConfig.recycleMode]}</p>
            </label>
          </div>

          <Button onClick={startSession} className="shadow-sm">
            Start practice session
          </Button>
          {status ? <p className="text-sm text-ink/60">{status}</p> : null}
        </div>
      ) : null}

      {view === "active" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-ink/10 bg-ink/[0.02] px-4 py-3">
            <p className="text-sm text-ink/60">
              Question {currentQuestionNumber} of {sessionConfig.sessionLength}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={endSession}>
              End session
            </Button>
          </div>

          {question ? (
            <div className="space-y-4">
              <div>
                <p className="text-xl font-semibold leading-8 tracking-tight text-ink">
                  {question.stem}
                </p>
              </div>
              {question.type === "MCQ" || question.type === "TRUE_FALSE" ? (
                <div className="space-y-2">
                  {(question.optionsJson ?? []).map((option) => (
                    <label key={option} className="flex items-center gap-2 text-sm text-ink/70">
                      <input
                        type="radio"
                        name={question.id}
                        value={option}
                        checked={answer === option}
                        disabled={feedback !== null}
                        onChange={() => setAnswer(option)}
                      />
                      {option}
                    </label>
                  ))}
                </div>
              ) : (
                <Textarea
                  value={answer}
                  disabled={feedback !== null}
                  onChange={(event) => setAnswer(event.target.value)}
                />
              )}

              {!feedback ? (
                <Button onClick={submit} disabled={!answer.trim()}>
                  Submit answer
                </Button>
              ) : (
                <div className="rounded-2xl border border-ink/10 bg-white p-5 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
                  <div className="space-y-4">
                    <p
                      className={`inline-flex rounded-full bg-ink/[0.03] px-3 py-1 text-sm font-medium ${feedbackStatusClass}`}
                    >
                      {feedbackStatus}
                    </p>
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
                        {isShortAnswer ? "Model answer" : "Correct answer"}
                      </p>
                      <p className="text-base leading-7 text-ink">{feedback.correctAnswer}</p>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
                        Explanation
                      </p>
                      <p className="text-base leading-7 text-ink/80">{feedback.rationale}</p>
                    </div>
                  </div>
                  {isShortAnswer ? (
                    <p className="mt-4 text-sm leading-6 text-ink/60">
                      This is a model-answer review rather than an objective score.
                    </p>
                  ) : null}
                  <div className="mt-5 space-y-2">
                    <p className="text-xs font-semibold uppercase text-ink/40">Citations</p>
                    {feedback.citations.length > 0 ? (
                      feedback.citations.map((citation, index) => (
                        <div key={`${citation.label}-${index}`} className="space-y-1 rounded-xl border border-ink/10 bg-ink/[0.02] p-3">
                          <p className="text-xs font-medium text-ink/50">{citation.label}</p>
                          <p className="text-xs text-ink/60">{citation.excerpt}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-ink/50">No supporting citation available.</p>
                    )}
                  </div>
                  <div className="mt-5 space-y-3 rounded-xl border border-ink/10 bg-ink/[0.02] p-4">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-ink">How was this question?</p>
                      <p className="text-xs text-ink/60">
                        “Incorrect question” means the question or answer seems wrong.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {questionFeedbackOptions.map((option) => (
                        <Button
                          key={option.value}
                          type="button"
                          size="sm"
                          variant={questionFeedback?.label === option.value ? "default" : "outline"}
                          onClick={() => saveQuestionFeedback(option.value)}
                          disabled={isSavingQuestionFeedback}
                        >
                          {option.label}
                        </Button>
                      ))}
                    </div>
                    {questionFeedbackStatus ? (
                      <p className="text-xs text-ink/60">{questionFeedbackStatus}</p>
                    ) : questionFeedback ? (
                      <p className="text-xs text-ink/60">
                        Saved as {getQuestionFeedbackLabel(questionFeedback.label) ?? "feedback"}.
                      </p>
                    ) : null}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button onClick={moveToNextQuestion}>
                      {results.length >= sessionConfig.sessionLength ? "View session summary" : "Next question"}
                    </Button>
                    <Button type="button" variant="outline" onClick={endSession}>
                      End session
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-ink/60">{status ?? "No questions available for this session."}</p>
          )}
        </div>
      ) : null}

      {view === "summary" ? (
        <div className="space-y-4 rounded-2xl border border-ink/10 bg-white p-5 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
          <div>
            <p className="text-lg font-medium text-ink">Practice session summary</p>
            <p className="text-sm text-ink/60">A quick view of how this session went.</p>
          </div>

          <div className="grid gap-2 text-sm text-ink/80">
            <p>Total answered: {totalAnswered}</p>
            <p>Objective questions: {objectiveCorrect}/{objectiveTotal} correct</p>
            <p>Objective incorrect: {objectiveIncorrect}</p>
            <p>Short-answer reviewed: {shortAnswerReviewed}</p>
            <p>Strong match: {shortAnswerStrongMatch}</p>
            <p>Partial match: {shortAnswerPartialMatch}</p>
            <p>Needs review: {shortAnswerNeedsReview}</p>
          </div>

          {topIncorrectTopic && topIncorrectTopic[1] >= 2 ? (
            <p className="text-sm text-ink/70">
              You missed several questions related to: <span className="font-medium text-ink">{topIncorrectTopic[0]}</span>
            </p>
          ) : null}

          {status ? <p className="text-sm text-ink/60">{status}</p> : null}

          <Button onClick={resetSession}>Start another session</Button>
        </div>
      ) : null}
    </div>
  );
}
