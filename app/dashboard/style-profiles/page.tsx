import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StyleProfileForm } from "@/app/dashboard/style-profiles/style-profile-form";

export default async function StyleProfilesPage() {
  const user = await requireUser();
  const profiles = await prisma.styleProfile.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: "desc" }
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create a question format</CardTitle>
          <CardDescription>
            Shape how your questions should look by uploading sample questions, past exam items,
            marking guides, or by describing the format in your own words.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StyleProfileForm />
        </CardContent>
      </Card>

      <Card>
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
            <ul className="space-y-2 text-sm">
              {profiles.map((profile) => (
                <li key={profile.id} className="rounded-md border border-ink/10 p-3">
                  <p className="font-medium text-ink">{profile.name}</p>
                  <p className="text-xs text-ink/50">Created {profile.createdAt.toDateString()}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
