import Link from "next/link";
import * as React from "react";
import { QuestionFeedbackLabel, QuestionType, VerifierStatus } from "@prisma/client";
import { ArchiveFeedbackQuestionButton } from "@/app/dashboard/admin/archive-feedback-question-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db/prisma";

const FEEDBACK_LABEL_OPTIONS: { value: QuestionFeedbackLabel | "ALL"; label: string }[] = [
  { value: "ALL", label: "All labels" },
  { value: "GOOD_EXAM_STYLE", label: "Good exam-style question" },
  { value: "TOO_EASY_LOW_VALUE", label: "Too easy / low value" },
  { value: "POOR_WORDING", label: "Poor wording" },
  { value: "NOT_EXAM_RELEVANT", label: "Not exam-relevant" },
  { value: "INCORRECT_OR_UNSUPPORTED", label: "Incorrect or unsupported" },
  { value: "DOCUMENT_TRIVIA", label: "Tests document trivia" },
  { value: "OTHER", label: "Other / add comment" },
  { value: "GOOD_QUESTION", label: "Legacy: Good question" },
  { value: "EASY", label: "Legacy: Easy" },
  { value: "HARD", label: "Legacy: Hard" },
  { value: "DISPUTED_INCORRECT", label: "Legacy: Incorrect question" },
  { value: "IRRELEVANT", label: "Legacy: Irrelevant" }
];

const QUESTION_TYPE_OPTIONS: { value: QuestionType | "ALL"; label: string }[] = [
  { value: "ALL", label: "All types" },
  { value: "MCQ", label: "MCQ" },
  { value: "TRUE_FALSE", label: "True/False" },
  { value: "SHORT_ANSWER", label: "Short answer" }
];

const ACTIVE_STATE_OPTIONS = [
  { value: "ALL", label: "All states" },
  { value: "ACTIVE", label: "Active question bank" },
  { value: "ARCHIVED", label: "Archived/inactive" },
  { value: "HIDDEN", label: "Hidden by learner" }
] as const;

type ActiveStateFilter = (typeof ACTIVE_STATE_OPTIONS)[number]["value"];

function getSingleSearchParam(
  value: string | string[] | undefined
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function parseFeedbackLabel(
  value: string | undefined
): QuestionFeedbackLabel | "ALL" {
  const match = FEEDBACK_LABEL_OPTIONS.find((option) => option.value === value);
  return match?.value ?? "ALL";
}

function parseQuestionType(value: string | undefined): QuestionType | "ALL" {
  const match = QUESTION_TYPE_OPTIONS.find((option) => option.value === value);
  return match?.value ?? "ALL";
}

function parseActiveState(value: string | undefined): ActiveStateFilter {
  const match = ACTIVE_STATE_OPTIONS.find((option) => option.value === value);
  return match?.value ?? "ALL";
}

export function getFeedbackLabelText(label: QuestionFeedbackLabel): string {
  if (label === "GOOD_EXAM_STYLE") return "Good exam-style question";
  if (label === "TOO_EASY_LOW_VALUE") return "Too easy / low value";
  if (label === "POOR_WORDING") return "Poor wording";
  if (label === "NOT_EXAM_RELEVANT") return "Not exam-relevant";
  if (label === "INCORRECT_OR_UNSUPPORTED") return "Incorrect or unsupported";
  if (label === "DOCUMENT_TRIVIA") return "Tests document trivia";
  if (label === "OTHER") return "Other / add comment";
  if (label === "GOOD_QUESTION") return "Legacy: Good question";
  if (label === "DISPUTED_INCORRECT") return "Legacy: Incorrect question";
  if (label === "IRRELEVANT") return "Legacy: Irrelevant";
  if (label === "EASY") return "Legacy: Easy";
  return "Legacy: Hard";
}

function getQuestionTypeText(type: QuestionType): string {
  if (type === "TRUE_FALSE") return "True/False";
  if (type === "SHORT_ANSWER") return "Short answer";
  return "MCQ";
}

function getVerifierStatusText(status: VerifierStatus): string {
  if (status === "PASSED") return "Active (PASSED)";
  if (status === "FAILED") return "Archived/inactive";
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

function stringArrayFromJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

type CitationRecord = {
  chunkId?: string;
  label?: string;
  page?: number;
  excerpt?: string;
};

function citationRecordsFromJson(value: unknown): CitationRecord[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      chunkId: typeof item.chunkId === "string" ? item.chunkId : undefined,
      label: typeof item.label === "string" ? item.label : undefined,
      page: typeof item.page === "number" ? item.page : undefined,
      excerpt: typeof item.excerpt === "string" ? item.excerpt : undefined
    }));
}

type AdminQuestionFeedbackViewerProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export async function AdminQuestionFeedbackViewer({
  searchParams
}: AdminQuestionFeedbackViewerProps) {
  const selectedLabel = parseFeedbackLabel(getSingleSearchParam(searchParams?.label));
  const selectedQuestionType = parseQuestionType(getSingleSearchParam(searchParams?.questionType));
  const selectedActiveState = parseActiveState(getSingleSearchParam(searchParams?.activeState));
  const commentsOnly = getSingleSearchParam(searchParams?.comments) === "1";

  const feedbackRows = await prisma.questionFeedback.findMany({
    where: {
      ...(selectedLabel !== "ALL" ? { label: selectedLabel } : {}),
      ...(commentsOnly ? { comment: { not: null } } : {}),
      question: {
        ...(selectedQuestionType !== "ALL" ? { type: selectedQuestionType } : {}),
        ...(selectedActiveState === "ACTIVE" ? { verifierStatus: "PASSED" } : {}),
        ...(selectedActiveState === "ARCHIVED" ? { verifierStatus: { not: "PASSED" } } : {}),
        ...(selectedActiveState === "HIDDEN"
          ? {
              questionExposures: {
                some: {
                  hiddenAt: {
                    not: null
                  }
                }
              }
            }
          : {})
      }
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      questionId: true,
      createdAt: true,
      updatedAt: true,
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
          id: true,
          stem: true,
          type: true,
          optionsJson: true,
          answer: true,
          rationale: true,
          citationsJson: true,
          verifierStatus: true,
          questionExposures: {
            where: {
              hiddenAt: {
                not: null
              }
            },
            select: {
              userId: true,
              hiddenAt: true
            },
            take: 5
          }
        }
      }
    }
  });

  const chunkIds = Array.from(
    new Set(
      feedbackRows.flatMap((row) =>
        citationRecordsFromJson(row.question.citationsJson)
          .map((citation) => citation.chunkId)
          .filter((chunkId): chunkId is string => Boolean(chunkId))
      )
    )
  );
  const chunks =
    chunkIds.length > 0
      ? await prisma.documentChunk.findMany({
          where: {
            id: {
              in: chunkIds
            }
          },
          select: {
            id: true,
            content: true,
            page: true,
            document: {
              select: {
                title: true,
                sourceType: true,
                storageKey: true
              }
            }
          }
        })
      : [];
  const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Question feedback</CardTitle>
        <CardDescription>
          Most recent learner feedback on generated questions. Expand a row to inspect the full item.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="grid gap-3 rounded-md border border-ink/10 bg-ink/[0.02] p-4 md:grid-cols-4 md:items-end">
          <label className="flex flex-col gap-2 text-sm text-ink/70">
            <span className="font-medium text-ink">Feedback label</span>
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

          <label className="flex flex-col gap-2 text-sm text-ink/70">
            <span className="font-medium text-ink">Question type</span>
            <select
              name="questionType"
              defaultValue={selectedQuestionType}
              className="h-10 rounded-md border border-ink/15 bg-white px-3 text-sm text-ink shadow-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {QUESTION_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2 text-sm text-ink/70">
            <span className="font-medium text-ink">Active state</span>
            <select
              name="activeState"
              defaultValue={selectedActiveState}
              className="h-10 rounded-md border border-ink/15 bg-white px-3 text-sm text-ink shadow-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {ACTIVE_STATE_OPTIONS.map((option) => (
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
            Only comments
          </label>

          <div className="flex items-center gap-2 md:col-span-4">
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
            {feedbackRows.map((row) => {
              const options = stringArrayFromJson(row.question.optionsJson);
              const citations = citationRecordsFromJson(row.question.citationsJson);
              const hiddenForFeedbackLearner = row.question.questionExposures.some(
                (exposure) => exposure.userId === row.user.id
              );
              const firstSourceChunk = citations
                .map((citation) => citation.chunkId ? chunksById.get(citation.chunkId) : null)
                .find(Boolean);
              const documentTitle = firstSourceChunk?.document.title ?? "Unknown source";

              return (
                <details
                  key={row.id}
                  className="group rounded-md border border-ink/10 bg-white p-4"
                >
                  <summary className="cursor-pointer list-none space-y-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-ink/55">
                      <Badge>{getFeedbackLabelText(row.label)}</Badge>
                      <span>{formatDateTime(row.createdAt)}</span>
                      <span>Learner: {row.user.email ?? row.user.id}</span>
                      <span>Type: {getQuestionTypeText(row.question.type)}</span>
                      <Badge className={getVerifierStatusClassName(row.question.verifierStatus)}>
                        {getVerifierStatusText(row.question.verifierStatus)}
                      </Badge>
                      {hiddenForFeedbackLearner ? (
                        <Badge className="bg-ink/10 text-ink">Hidden by learner</Badge>
                      ) : null}
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
                    <p className="text-xs font-medium text-accent group-open:hidden">Expand row</p>
                  </summary>

                  <div className="mt-5 space-y-5 border-t border-ink/10 pt-5">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
                          Full question
                        </p>
                        <p className="text-sm leading-6 text-ink">{row.question.stem}</p>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
                          Source
                        </p>
                        <p className="text-sm text-ink">{documentTitle}</p>
                        {firstSourceChunk ? (
                          <p className="text-xs text-ink/55">
                            {firstSourceChunk.document.sourceType}
                            {firstSourceChunk.page ? `, page ${firstSourceChunk.page}` : ""}
                          </p>
                        ) : (
                          <p className="text-xs text-ink/55">No linked source chunk found.</p>
                        )}
                      </div>
                    </div>

                    {options.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
                          Options
                        </p>
                        <ol className="grid gap-2 text-sm text-ink/80">
                          {options.map((option, index) => (
                            <li key={`${row.id}-option-${index}`}>
                              {String.fromCharCode(65 + index)}. {option}
                            </li>
                          ))}
                        </ol>
                      </div>
                    ) : null}

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
                          Correct answer
                        </p>
                        <p className="text-sm leading-6 text-ink">{row.question.answer}</p>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
                          Learner comment
                        </p>
                        <p className="text-sm leading-6 text-ink/80">
                          {row.comment ?? "No comment"}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
                        Rationale / explanation
                      </p>
                      <p className="text-sm leading-6 text-ink/80">{row.question.rationale}</p>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
                        Citations and source context
                      </p>
                      {citations.length > 0 ? (
                        <div className="grid gap-2">
                          {citations.map((citation, index) => {
                            const chunk = citation.chunkId ? chunksById.get(citation.chunkId) : null;

                            return (
                              <div
                                key={`${row.id}-citation-${index}`}
                                className="space-y-1 rounded-md border border-ink/10 bg-ink/[0.02] p-3"
                              >
                                <p className="text-xs font-medium text-ink/60">
                                  {citation.label ?? `Citation ${index + 1}`}
                                  {citation.page ? `, page ${citation.page}` : ""}
                                </p>
                                <p className="text-sm leading-6 text-ink/75">
                                  {citation.excerpt ?? "No citation excerpt stored."}
                                </p>
                                {chunk ? (
                                  <p className="text-xs leading-5 text-ink/55">
                                    Source context: {truncateText(chunk.content, 500)}
                                  </p>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-ink/60">No citations stored.</p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 border-t border-ink/10 pt-4 text-xs text-ink/55">
                      <span>Feedback updated: {formatDateTime(row.updatedAt)}</span>
                      <span>Question ID: {row.questionId}</span>
                      <span>Global state: {getVerifierStatusText(row.question.verifierStatus)}</span>
                      {row.question.verifierStatus === "PASSED" ? (
                        <ArchiveFeedbackQuestionButton questionId={row.question.id} />
                      ) : null}
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
