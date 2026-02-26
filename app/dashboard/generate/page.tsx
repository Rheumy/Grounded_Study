import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GenerateForm } from "@/app/dashboard/generate/generate-form";

export default async function GeneratePage() {
  const user = await requireUser();
  const documents = await prisma.document.findMany({
    where: { ownerId: user.id, status: "READY" },
    orderBy: { createdAt: "desc" }
  });
  const profiles = await prisma.styleProfile.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: "desc" }
  });

  const safeDocs = documents.map((doc) => ({ id: doc.id, title: doc.title }));
  const safeProfiles = profiles.map((profile) => ({ id: profile.id, name: profile.name }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate questions</CardTitle>
        <CardDescription>Questions are grounded in retrieved chunks and verified.</CardDescription>
      </CardHeader>
      <CardContent>
        <GenerateForm documents={safeDocs} profiles={safeProfiles} />
      </CardContent>
    </Card>
  );
}
