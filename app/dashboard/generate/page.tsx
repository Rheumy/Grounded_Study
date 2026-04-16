import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { resolveUserGenerationCaps } from "@/lib/billing/generation-limits";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GenerateForm } from "@/app/dashboard/generate/generate-form";

type ProfileSchema = {
  questionTypeDistribution?: { MCQ?: number; SHORT_ANSWER?: number; TRUE_FALSE?: number };
};

export default async function GeneratePage() {
  const user = await requireUser();
  const generationCaps = await resolveUserGenerationCaps(user.id);
  const documents = await prisma.document.findMany({
    where: { ownerId: user.id, status: "READY" },
    orderBy: { createdAt: "desc" }
  });
  const profiles = await prisma.styleProfile.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: "desc" }
  });

  const safeDocs = documents.map((doc) => ({ id: doc.id, title: doc.title }));
  const safeProfiles = profiles.map((profile) => {
    const schema = profile.schemaJson as ProfileSchema;
    return {
      id: profile.id,
      name: profile.name,
      distribution: schema.questionTypeDistribution ?? null
    };
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your question bank</CardTitle>
        <CardDescription>Create new questions from your uploaded study material.</CardDescription>
      </CardHeader>
      <CardContent>
        <GenerateForm
          documents={safeDocs}
          profiles={safeProfiles}
          maxRequestCount={generationCaps.planMaxCount}
        />
      </CardContent>
    </Card>
  );
}
