import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { resolveUserGenerationCaps } from "@/lib/billing/generation-limits";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GenerateForm } from "@/app/dashboard/generate/generate-form";

export default async function GeneratePage() {
  const user = await requireUser();
  const generationCaps = await resolveUserGenerationCaps(user.id);
  const documents = await prisma.document.findMany({
    where: { ownerId: user.id, status: "READY" },
    orderBy: { createdAt: "desc" }
  });

  const safeDocs = documents.map((doc) => ({ id: doc.id, title: doc.title }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your question bank</CardTitle>
        <CardDescription>
          Create new questions from your uploaded study material.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 rounded-md border border-danger/20 bg-danger/[0.04] p-3 text-sm text-ink/75">
          Please do not upload patient-identifiable information or confidential clinical records.
        </div>
        <GenerateForm
          documents={safeDocs}
          maxRequestCount={generationCaps.planMaxCount}
        />
      </CardContent>
    </Card>
  );
}
