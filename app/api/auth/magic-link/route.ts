import { NextResponse } from "next/server";
import { normalizeEmailIdentifier } from "@/lib/auth/email-access";
import { issueMagicLink, MagicLinkRequestError, resolveAuthBaseUrl } from "@/lib/auth/email";
import { PENDING_MAGIC_LINK_EMAIL_COOKIE_NAME } from "@/lib/constants/legal";
import { rateLimit } from "@/lib/security/rate-limit";

const BLOCKED_ALLOWLIST_MESSAGE =
  "This email is not on the private beta allowlist yet. Want access? Email beta@sulcai.com.";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const rawEmail = typeof body.email === "string" ? body.email : "";

  let normalizedEmail: string;
  try {
    normalizedEmail = normalizeEmailIdentifier(rawEmail);
  } catch {
    return NextResponse.json(
      {
        status: "error",
        error: "Enter a valid email address and try again."
      },
      { status: 400 }
    );
  }

  const limit = await rateLimit(`magic-link:send:${normalizedEmail}`, 1, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        status: "error",
        error: "Please wait a minute before requesting another sign-in link."
      },
      { status: 429 }
    );
  }

  try {
    await issueMagicLink({
      email: normalizedEmail,
      baseUrl: resolveAuthBaseUrl(request),
      callbackUrl: "/dashboard"
    });

    const response = NextResponse.json({ status: "sent", email: normalizedEmail });
    response.cookies.set(PENDING_MAGIC_LINK_EMAIL_COOKIE_NAME, normalizedEmail, {
      path: "/",
      maxAge: 60 * 60 * 24,
      sameSite: "lax"
    });
    return response;
  } catch (error) {
    if (error instanceof MagicLinkRequestError && error.status === 403) {
      return NextResponse.json(
        {
          status: "blocked_allowlist",
          error: BLOCKED_ALLOWLIST_MESSAGE
        },
        { status: 403 }
      );
    }

    if (error instanceof MagicLinkRequestError) {
      return NextResponse.json(
        {
          status: "error",
          error: error.publicMessage
        },
        { status: error.status }
      );
    }

    return NextResponse.json(
      {
        status: "error",
        error: "We couldn't send the sign-in link right now. Please try again."
      },
      { status: 500 }
    );
  }
}
