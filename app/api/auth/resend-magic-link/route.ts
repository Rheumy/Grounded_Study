import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { normalizeEmailIdentifier } from "@/lib/auth/email-access";
import { issueMagicLink, MagicLinkRequestError, resolveAuthBaseUrl } from "@/lib/auth/email";
import { PENDING_MAGIC_LINK_EMAIL_COOKIE_NAME } from "@/lib/constants/legal";
import { rateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const rawCookieEmail = cookies().get(PENDING_MAGIC_LINK_EMAIL_COOKIE_NAME)?.value ?? null;
  const cookieEmail = rawCookieEmail ? decodeURIComponent(rawCookieEmail) : null;
  const rawEmail =
    typeof body.email === "string" && body.email.trim().length > 0 ? body.email : cookieEmail;

  if (!rawEmail) {
    return NextResponse.json(
      { error: "Go back to sign in and enter your email address again." },
      { status: 400 }
    );
  }

  let normalizedEmail: string;
  try {
    normalizedEmail = normalizeEmailIdentifier(rawEmail);
  } catch {
    return NextResponse.json(
      { error: "Enter a valid email address and try again." },
      { status: 400 }
    );
  }

  const limit = await rateLimit(`magic-link:resend:${normalizedEmail}`, 1, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Please wait a minute before requesting another sign-in link." },
      { status: 429 }
    );
  }

  try {
    await issueMagicLink({
      email: normalizedEmail,
      baseUrl: resolveAuthBaseUrl(request),
      callbackUrl: "/dashboard"
    });

    const response = NextResponse.json({ ok: true });
    response.cookies.set(PENDING_MAGIC_LINK_EMAIL_COOKIE_NAME, normalizedEmail, {
      path: "/",
      maxAge: 60 * 60 * 24,
      sameSite: "lax"
    });
    return response;
  } catch (error) {
    if (error instanceof MagicLinkRequestError) {
      return NextResponse.json({ error: error.publicMessage }, { status: error.status });
    }

    return NextResponse.json(
      { error: "We couldn't resend the sign-in link right now. Please try again." },
      { status: 500 }
    );
  }
}
