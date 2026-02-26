import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UploadForm } from "@/app/dashboard/documents/upload-form";
import { DocumentsList } from "@/app/dashboard/documents/documents-list";

export default async function DocumentsPage() {
  const user = await requireUser();
  const documents = await prisma.document.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: "desc" }
  });

  const safeDocs = documents.map((doc) => ({
    id: doc.id,
    title: doc.title,
    status: doc.status
  }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload materials</CardTitle>
          <CardDescription>PDFs and images are ingested into your grounded knowledge base.</CardDescription>
        </CardHeader>
        <CardContent>
          <UploadForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
          <CardDescription>Track ingestion status and manage uploads.</CardDescription>
        </CardHeader>
        <CardContent>
          <DocumentsList documents={safeDocs} />
        </CardContent>
      </Card>
    </div>
  );
}
