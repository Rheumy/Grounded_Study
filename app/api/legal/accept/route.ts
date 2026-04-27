import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/require-user-api";
import { prisma } from "@/lib/db/prisma";
import {
  LEGAL_CONSENT_COOKIE_NAME,
  LEGAL_VERSION
} from "@/lib/constants/legal";

export async function POST() {
  const user = await requireUserApi();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      legalAcceptedAt: new Date(),
      legalVersion: LEGAL_VERSION
    }
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(LEGAL_CONSENT_COOKIE_NAME, LEGAL_VERSION, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax"
  });
  return response;
}
