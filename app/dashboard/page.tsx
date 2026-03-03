import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/options";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Welcome back</h1>
        <p className="text-ink/60">Signed in as {session?.user?.email}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[
          { title: "Documents", description: "Track upload and ingestion progress." },
          { title: "Questions", description: "Generate grounded questions with citations." },
          { title: "Analytics", description: "See accuracy by topic and difficulty." }
        ].map((card) => (
          <Card key={card.title}>
            <CardHeader>
              <CardTitle>{card.title}</CardTitle>
              <CardDescription>{card.description}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-ink/60">More details coming in Slice 4.</CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
