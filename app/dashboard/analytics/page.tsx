import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AnalyticsPage() {
  const user = await requireUser();
  const attempts = await prisma.practiceAttempt.findMany({
    where: { userId: user.id },
    include: { question: true }
  });

  const difficultyStats: Record<string, { correct: number; total: number }> = {};
  const tagStats: Record<string, { correct: number; total: number }> = {};

  for (const attempt of attempts) {
    const difficulty = String(attempt.question.difficulty);
    difficultyStats[difficulty] = difficultyStats[difficulty] ?? { correct: 0, total: 0 };
    difficultyStats[difficulty].total += 1;
    if (attempt.correct) difficultyStats[difficulty].correct += 1;

    const tags = (attempt.question.tagsJson as string[]) ?? [];
    for (const tag of tags) {
      tagStats[tag] = tagStats[tag] ?? { correct: 0, total: 0 };
      tagStats[tag].total += 1;
      if (attempt.correct) tagStats[tag].correct += 1;
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Accuracy by difficulty</CardTitle>
          <CardDescription>Practice performance grouped by level.</CardDescription>
        </CardHeader>
        <CardContent>
          {Object.keys(difficultyStats).length === 0 ? (
            <p className="text-sm text-ink/60">No data yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {Object.entries(difficultyStats).map(([level, stat]) => (
                <li key={level}>
                  Level {level}: {stat.correct}/{stat.total} correct
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accuracy by tag</CardTitle>
          <CardDescription>Topic coverage and performance.</CardDescription>
        </CardHeader>
        <CardContent>
          {Object.keys(tagStats).length === 0 ? (
            <p className="text-sm text-ink/60">No tag data yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {Object.entries(tagStats).map(([tag, stat]) => (
                <li key={tag}>
                  {tag}: {stat.correct}/{stat.total} correct
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
