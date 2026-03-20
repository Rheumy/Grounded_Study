import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/options";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminIngestButton } from "@/app/dashboard/admin/admin-ingest-button";

export default async function AdminPage() {
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

  const [userCount, documentCount, questionCount] = await Promise.all([
    prisma.user.count(),
    prisma.document.count(),
    prisma.question.count()
  ]);

  const recentUsage = await prisma.usageCounter.findMany({
    orderBy: { day: "desc" },
    take: 5
  });

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
    </div>
  );
}
