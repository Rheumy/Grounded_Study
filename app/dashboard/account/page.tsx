import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AccountActions } from "@/app/dashboard/account/account-client";

function authMethodLabel(providers: string[]) {
  if (providers.includes("google")) {
    return "Google";
  }

  if (providers.includes("email") || providers.length === 0) {
    return "Email magic link";
  }

  return providers.join(", ");
}

export default async function AccountPage() {
  const sessionUser = await requireUser();
  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      email: true,
      createdAt: true,
      accounts: {
        select: {
          provider: true
        }
      }
    }
  });

  if (!user) {
    return null;
  }

  const providers = user.accounts.map((account) => account.provider);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>Manage your private beta account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <dl className="grid gap-4 text-sm">
          <div className="grid gap-1">
            <dt className="font-medium text-ink">Email address</dt>
            <dd className="text-ink/65">{user.email ?? "No email on file"}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="font-medium text-ink">Authentication method</dt>
            <dd className="text-ink/65">{authMethodLabel(providers)}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="font-medium text-ink">Account created</dt>
            <dd className="text-ink/65">{user.createdAt.toLocaleDateString()}</dd>
          </div>
        </dl>

        <div className="rounded-md border border-danger/20 bg-danger/[0.03] p-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Account actions</p>
            <p className="text-sm text-ink/60">
              Deleting your account removes your uploaded materials, generated questions, practice
              attempts, mock exams, and account records.
            </p>
          </div>
          <div className="mt-4">
            <AccountActions />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
