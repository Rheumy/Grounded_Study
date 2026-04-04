import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StyleProfileForm } from "@/app/dashboard/style-profiles/style-profile-form";

type ProfileSchema = {
  questionTypeDistribution?: { MCQ?: number; SHORT_ANSWER?: number; TRUE_FALSE?: number };
  answerStyle?: string;
  explanationTone?: string;
  difficultyMap?: Record<string, string>;
};

function typeLabel(dist: ProfileSchema["questionTypeDistribution"]): string {
  if (!dist) return "Default";
  const parts: string[] = [];
  if ((dist.MCQ ?? 0) > 0) parts.push("MCQ");
  if ((dist.SHORT_ANSWER ?? 0) > 0) parts.push("Short answer");
  if ((dist.TRUE_FALSE ?? 0) > 0) parts.push("True/False");
  return parts.length > 0 ? parts.join(", ") : "Default";
}

export default async function StyleProfilesPage() {
  const user = await requireUser();
  const profiles = await prisma.styleProfile.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: "desc" }
  });

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-ink/10 bg-ink/[0.02] p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/45">Question format</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Capture the exam style you are studying for</h1>
        <p className="mt-2 max-w-3xl text-sm text-ink/65">
          Clearer context leads to more useful questions and more grounded feedback. If you want
          subjective or short-answer formats, include model answers, rubrics, or marking guides
          whenever you can.
        </p>
      </div>

      <Card className="border-ink/15 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
        <CardHeader>
          <CardTitle>Create a question format</CardTitle>
          <CardDescription>
            Shape how your questions should look by adding examples, optional study context, sample
            files, or plain-English instructions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StyleProfileForm />
        </CardContent>
      </Card>

      <Card className="border-ink/15 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
        <CardHeader>
          <CardTitle>Saved question formats</CardTitle>
          <CardDescription>Choose one of these when generating new questions.</CardDescription>
        </CardHeader>
        <CardContent>
          {profiles.length === 0 ? (
            <p className="text-sm text-ink/60">
              No custom question formats yet. The default format is available if you want to get
              started straight away.
            </p>
          ) : (
            <ul className="space-y-3 text-sm">
              {profiles.map((profile) => {
                const schema = profile.schemaJson as ProfileSchema;
                return (
                  <li key={profile.id} className="space-y-1 rounded-2xl border border-ink/10 bg-ink/[0.02] p-4">
                    <p className="font-medium text-ink">{profile.name}</p>
                    <p className="text-xs text-ink/50">
                      Question types: {typeLabel(schema.questionTypeDistribution)}
                    </p>
                    {schema.answerStyle ? (
                      <p className="text-xs text-ink/50">Answer style: {schema.answerStyle}</p>
                    ) : null}
                    {schema.explanationTone ? (
                      <p className="text-xs text-ink/50">Tone: {schema.explanationTone}</p>
                    ) : null}
                    <p className="text-xs text-ink/40">Created {profile.createdAt.toDateString()}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
