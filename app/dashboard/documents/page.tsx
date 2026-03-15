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
          <CardTitle>Upload study materials</CardTitle>
          <CardDescription>
            Upload textbooks, lecture notes, handouts, or past papers to build your question bank.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UploadForm
            userId={user.id}
            useClientUploads={Boolean(process.env.BLOB_READ_WRITE_TOKEN && process.env.VERCEL)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your study materials</CardTitle>
          <CardDescription>Track upload and processing status here.</CardDescription>
        </CardHeader>
        <CardContent>
          <DocumentsList documents={safeDocs} />
        </CardContent>
      </Card>
    </div>
  );
}
