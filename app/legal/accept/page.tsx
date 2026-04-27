import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { LegalAcceptClient } from "@/components/legal/legal-accept-client";
import { prisma } from "@/lib/db/prisma";
import { authOptions } from "@/lib/auth/options";

export default async function LegalAcceptPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { legalAcceptedAt: true }
  });

  if (user?.legalAcceptedAt) {
    redirect("/dashboard");
  }

  return <LegalAcceptClient />;
}

