import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/options";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Welcome to Grounded Study</h1>
        <p className="text-ink/60">
          Turn your study materials into exam-style questions for revision, practice, and mock exams.
        </p>
        <p className="text-sm text-ink/50">Signed in as {session?.user?.email}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[
          { title: "Study Materials", description: "Upload and track the materials behind your questions." },
          { title: "Generate Questions", description: "Create new revision questions from ready study materials." },
          { title: "Progress", description: "See how you are performing over time." }
        ].map((card) => (
          <Card key={card.title}>
            <CardHeader>
              <CardTitle>{card.title}</CardTitle>
              <CardDescription>{card.description}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-ink/60">Open this section from the sidebar to continue.</CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
