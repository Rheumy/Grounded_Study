import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/options";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminIngestButton } from "@/app/dashboard/admin/admin-ingest-button";
import { AdminQuestionFeedbackViewer } from "@/app/dashboard/admin/question-feedback-viewer";

function toAmount(value: { toNumber(): number } | number | null | undefined): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "toNumber" in value) return value.toNumber();
  return 0;
}

function formatUsd(value: number): string {
  if (value === 0) return "$0.0000";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  }).format(value);
}

type AdminPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Admin</CardTitle>
          <CardDescription>Access restricted.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ink/60">You do not have admin access.</p>
        </CardContent>
      </Card>
    );
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(startOfToday);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  const [
    userCount,
    documentCount,
    questionCount,
    recentUsage,
    totalAiCost,
    todayAiCost,
    last7DaysAiCost,
    featureBreakdown,
    modelBreakdown,
    recentAiUsage,
    ingestionPipelineCost,
    aiTrackedDocumentCount
  ] = await Promise.all([
    prisma.user.count(),
    prisma.document.count(),
    prisma.question.count(),
    prisma.usageCounter.findMany({
      orderBy: { day: "desc" },
      take: 5
    }),
    prisma.aiUsageEvent.aggregate({
      _sum: { estimatedCostUsd: true }
    }),
    prisma.aiUsageEvent.aggregate({
      where: { createdAt: { gte: startOfToday } },
      _sum: { estimatedCostUsd: true }
    }),
    prisma.aiUsageEvent.aggregate({
      where: { createdAt: { gte: sevenDaysAgo } },
      _sum: { estimatedCostUsd: true }
    }),
    prisma.aiUsageEvent.groupBy({
      by: ["feature"],
      _sum: { estimatedCostUsd: true, totalTokens: true },
      _count: { _all: true }
    }),
    prisma.aiUsageEvent.groupBy({
      by: ["model"],
      _sum: { estimatedCostUsd: true, totalTokens: true },
      _count: { _all: true }
    }),
    prisma.aiUsageEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 12
    }),
    prisma.aiUsageEvent.aggregate({
      where: {
        OR: [
          { feature: "document_embedding", documentId: { not: null } },
          { feature: "ocr", documentId: { not: null } }
        ]
      },
      _sum: { estimatedCostUsd: true }
    }),
    prisma.document.count({
      where: {
        aiUsageEvents: {
          some: {
            OR: [{ feature: "document_embedding" }, { feature: "ocr" }]
          }
        }
      }
    })
  ]);

  const totalEstimatedCost = toAmount(totalAiCost._sum.estimatedCostUsd);
  const costToday = toAmount(todayAiCost._sum.estimatedCostUsd);
  const costLast7Days = toAmount(last7DaysAiCost._sum.estimatedCostUsd);
  const averageCostPerIngestedDocument =
    aiTrackedDocumentCount > 0
      ? toAmount(ingestionPipelineCost._sum.estimatedCostUsd) / aiTrackedDocumentCount
      : 0;

  const featureRows = featureBreakdown
    .map((row) => ({
      feature: row.feature,
      cost: toAmount(row._sum.estimatedCostUsd),
      tokens: row._sum.totalTokens ?? 0,
      calls: row._count._all
    }))
    .sort((a, b) => b.cost - a.cost);

  const modelRows = modelBreakdown
    .map((row) => ({
      model: row.model,
      cost: toAmount(row._sum.estimatedCostUsd),
      tokens: row._sum.totalTokens ?? 0,
      calls: row._count._all
    }))
    .sort((a, b) => b.cost - a.cost);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Manual ingestion</CardTitle>
          <CardDescription>
            Trigger a single ingestion job manually. This processes the next queued document.
            Run once per queued document until all are ingested.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdminIngestButton />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Platform overview</CardTitle>
          <CardDescription>High-level counts.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-ink/70">
          <p>Users: {userCount}</p>
          <p>Study materials: {documentCount}</p>
          <p>Questions: {questionCount}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI usage and cost</CardTitle>
          <CardDescription>
            Estimated OpenAI usage across ingestion, generation, verification, grading, and style extraction.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-2xl border border-ink/10 bg-ink/[0.02] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Total cost</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-ink">{formatUsd(totalEstimatedCost)}</p>
            </div>
            <div className="rounded-2xl border border-ink/10 bg-ink/[0.02] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Today</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-ink">{formatUsd(costToday)}</p>
            </div>
            <div className="rounded-2xl border border-ink/10 bg-ink/[0.02] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Last 7 days</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-ink">{formatUsd(costLast7Days)}</p>
            </div>
            <div className="rounded-2xl border border-ink/10 bg-ink/[0.02] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Avg per ingested document</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-ink">
                {formatUsd(averageCostPerIngestedDocument)}
              </p>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="space-y-3 rounded-2xl border border-ink/10 bg-white p-4">
              <div>
                <p className="text-sm font-medium text-ink">Cost by feature</p>
                <p className="text-xs text-ink/55">Grouped across all recorded AI usage events.</p>
              </div>
              {featureRows.length === 0 ? (
                <p className="text-sm text-ink/60">No AI usage recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {featureRows.map((row) => (
                    <div
                      key={row.feature}
                      className="flex items-center justify-between gap-4 rounded-xl border border-ink/8 bg-ink/[0.02] px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium text-ink">{row.feature}</p>
                        <p className="text-xs text-ink/50">
                          {row.calls} call{row.calls === 1 ? "" : "s"} · {row.tokens.toLocaleString()} tokens
                        </p>
                      </div>
                      <p className="text-sm font-medium text-ink">{formatUsd(row.cost)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-2xl border border-ink/10 bg-white p-4">
              <div>
                <p className="text-sm font-medium text-ink">Cost by model</p>
                <p className="text-xs text-ink/55">Useful for pricing updates and model comparisons.</p>
              </div>
              {modelRows.length === 0 ? (
                <p className="text-sm text-ink/60">No AI usage recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {modelRows.map((row) => (
                    <div
                      key={row.model}
                      className="flex items-center justify-between gap-4 rounded-xl border border-ink/8 bg-ink/[0.02] px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium text-ink">{row.model}</p>
                        <p className="text-xs text-ink/50">
                          {row.calls} call{row.calls === 1 ? "" : "s"} · {row.tokens.toLocaleString()} tokens
                        </p>
                      </div>
                      <p className="text-sm font-medium text-ink">{formatUsd(row.cost)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-ink/10 bg-white p-4">
            <div>
              <p className="text-sm font-medium text-ink">Recent AI usage events</p>
              <p className="text-xs text-ink/55">Latest recorded model calls and estimated cost.</p>
            </div>
            {recentAiUsage.length === 0 ? (
              <p className="text-sm text-ink/60">No AI usage recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {recentAiUsage.map((event) => (
                  <div
                    key={event.id}
                    className="grid gap-2 rounded-xl border border-ink/8 bg-ink/[0.02] px-3 py-3 text-sm text-ink/70 md:grid-cols-[1.2fr_1fr_auto]"
                  >
                    <div>
                      <p className="font-medium text-ink">{event.feature}</p>
                      <p className="text-xs text-ink/50">
                        {event.createdAt.toLocaleString()} · {event.model}
                      </p>
                    </div>
                    <div className="text-xs text-ink/55">
                      <p>Input: {event.inputTokens ?? "n/a"}</p>
                      <p>Output: {event.outputTokens ?? "n/a"}</p>
                      <p>Total: {event.totalTokens ?? "n/a"}</p>
                    </div>
                    <p className="text-sm font-medium text-ink">{formatUsd(toAmount(event.estimatedCostUsd))}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent usage</CardTitle>
          <CardDescription>Latest daily counters.</CardDescription>
        </CardHeader>
        <CardContent>
          {recentUsage.length === 0 ? (
            <p className="text-sm text-ink/60">No usage yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {recentUsage.map((row) => (
                <li key={row.id}>
                  {row.day.toDateString()}: uploads {row.uploads}, questions {row.questions}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AdminQuestionFeedbackViewer searchParams={searchParams} />
    </div>
  );
}
