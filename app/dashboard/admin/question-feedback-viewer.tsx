import Link from "next/link";
import { QuestionFeedbackLabel, QuestionType, VerifierStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db/prisma";

const FEEDBACK_LABEL_OPTIONS: { value: QuestionFeedbackLabel | "ALL"; label: string }[] = [
  { value: "ALL", label: "All labels" },
  { value: "GOOD_QUESTION", label: "Good question" },
  { value: "EASY", label: "Easy" },
  { value: "HARD", label: "Hard" },
  { value: "DISPUTED_INCORRECT", label: "Incorrect question" },
  { value: "IRRELEVANT", label: "Irrelevant" }
];

function getSingleSearchParam(
  value: string | string[] | undefined
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function parseFeedbackLabel(
  value: string | undefined
): QuestionFeedbackLabel | "ALL" {
  if (
    value === "EASY" ||
    value === "HARD" ||
    value === "GOOD_QUESTION" ||
    value === "DISPUTED_INCORRECT" ||
    value === "IRRELEVANT"
  ) {
    return value;
  }

  return "ALL";
}

function getFeedbackLabelText(label: QuestionFeedbackLabel): string {
  if (label === "GOOD_QUESTION") return "Good question";
  if (label === "DISPUTED_INCORRECT") return "Incorrect question";
  if (label === "IRRELEVANT") return "Irrelevant";
  if (label === "EASY") return "Easy";
  return "Hard";
}

function getQuestionTypeText(type: QuestionType): string {
  if (type === "TRUE_FALSE") return "True/False";
  if (type === "SHORT_ANSWER") return "Short answer";
  return "MCQ";
}

function getVerifierStatusText(status: VerifierStatus): string {
  if (status === "PASSED") return "Active (PASSED)";
  if (status === "FAILED") return "Failed";
  if (status === "INSUFFICIENT_EVIDENCE") return "Insufficient evidence";
  return "Pending";
}

function getVerifierStatusClassName(status: VerifierStatus): string {
  if (status === "PASSED") {
    return "bg-accentSoft text-accent";
  }

  if (status === "FAILED") {
    return "bg-danger/10 text-danger";
  }

  return "bg-ink/10 text-ink";
}

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(value);
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

type AdminQuestionFeedbackViewerProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export async function AdminQuestionFeedbackViewer({
  searchParams
}: AdminQuestionFeedbackViewerProps) {
  const selectedLabel = parseFeedbackLabel(getSingleSearchParam(searchParams?.label));
  const commentsOnly = getSingleSearchParam(searchParams?.comments) === "1";

  const feedbackRows = await prisma.questionFeedback.findMany({
    where: {
      ...(selectedLabel !== "ALL" ? { label: selectedLabel } : {}),
      ...(commentsOnly ? { comment: { not: null } } : {})
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      createdAt: true,
      label: true,
      comment: true,
      user: {
        select: {
          id: true,
          email: true
        }
      },
      question: {
        select: {
          stem: true,
          type: true,
          verifierStatus: true
        }
      }
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Question feedback</CardTitle>
        <CardDescription>
          Most recent learner feedback on generated questions. Showing up to 50 matching rows.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="flex flex-col gap-3 rounded-2xl border border-ink/10 bg-ink/[0.02] p-4 md:flex-row md:items-end">
          <label className="flex min-w-[220px] flex-1 flex-col gap-2 text-sm text-ink/70">
            <span className="font-medium text-ink">Filter by label</span>
            <select
              name="label"
              defaultValue={selectedLabel}
              className="h-10 rounded-md border border-ink/15 bg-white px-3 text-sm text-ink shadow-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {FEEDBACK_LABEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex h-10 items-center gap-2 rounded-md border border-ink/15 bg-white px-3 text-sm text-ink">
            <input
              type="checkbox"
              name="comments"
              value="1"
              defaultChecked={commentsOnly}
              className="h-4 w-4 rounded border-ink/30 text-accent focus:ring-accent"
            />
            Only rows with comments
          </label>

          <div className="flex items-center gap-2">
            <Button type="submit">Apply</Button>
            <Link
              href="/dashboard/admin"
              className="inline-flex h-10 items-center justify-center rounded-md border border-ink/20 px-4 text-sm font-medium text-ink transition hover:bg-ink/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              Reset
            </Link>
          </div>
        </form>

        {feedbackRows.length === 0 ? (
          <p className="text-sm text-ink/60">No feedback matches the current filters yet.</p>
        ) : (
          <div className="space-y-3">
            {feedbackRows.map((row) => (
              <div
                key={row.id}
                className="space-y-3 rounded-2xl border border-ink/10 bg-white p-4"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink/55">
                  <Badge>{getFeedbackLabelText(row.label)}</Badge>
                  <span>{formatDateTime(row.createdAt)}</span>
                  <span>Learner: {row.user.email ?? row.user.id}</span>
                  <span>Type: {getQuestionTypeText(row.question.type)}</span>
                  <Badge className={getVerifierStatusClassName(row.question.verifierStatus)}>
                    {getVerifierStatusText(row.question.verifierStatus)}
                  </Badge>
                </div>

                <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
                      Question
                    </p>
                    <p className="mt-1 text-sm text-ink">
                      {truncateText(row.question.stem, 220)}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
                      Comment
                    </p>
                    <p className="mt-1 text-sm text-ink/75">
                      {row.comment ? truncateText(row.comment, 280) : "No comment"}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
