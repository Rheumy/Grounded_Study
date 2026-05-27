import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/require-user";
import { getOrCreateSubscription } from "@/lib/billing/subscription";
import { resolvePlanLimits } from "@/lib/billing/plans";
import { prisma } from "@/lib/db/prisma";
import { BillingClient } from "@/app/dashboard/billing/billing-client";

export default async function BillingPage() {
  const user = await requireUser();
  const subscription = await getOrCreateSubscription(user.id);
  const limits = resolvePlanLimits(subscription.plan);

  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const counter = await prisma.usageCounter.findUnique({
    where: { userId_day: { userId: user.id, day } }
  });

  const usage = {
    uploads: counter?.uploads ?? 0,
    questions: counter?.questions ?? 0,
    storageBytes: Number(counter?.storageBytes ?? 0n)
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Private beta usage</CardTitle>
        <CardDescription>
          SULCAI is free during this controlled private beta. Daily safety limits still apply.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <BillingClient
          plan={subscription.plan}
          limits={limits}
          usage={usage}
        />
      </CardContent>
    </Card>
  );
}
