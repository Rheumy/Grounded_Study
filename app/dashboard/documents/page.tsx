import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UploadForm } from "@/app/dashboard/documents/upload-form";
import { DocumentsList } from "@/app/dashboard/documents/documents-list";

export default async function DocumentsPage() {
  const user = await requireUser();
  const documents = await prisma.document.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      ingestionJobs: {
        orderBy: { updatedAt: "desc" },
        take: 1
      }
    }
  });

  const safeDocs = documents.map((doc) => ({
    id: doc.id,
    title: doc.title,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
    latestError: doc.ingestionJobs[0]?.lastError ?? null
  }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload study materials</CardTitle>
          <CardDescription>
            Upload textbooks, lecture notes, handouts, or past papers. We will queue and start
            processing them automatically after upload.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 rounded-md border border-danger/20 bg-danger/[0.04] p-3 text-sm text-ink/75">
            Please do not upload patient-identifiable information or confidential clinical records.
          </div>
          <UploadForm
            userId={user.id}
            useClientUploads={Boolean(process.env.BLOB_READ_WRITE_TOKEN && process.env.VERCEL)}
            documents={safeDocs}
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
