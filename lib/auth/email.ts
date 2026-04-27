import { createHash, randomBytes } from "node:crypto";
import type { SendVerificationRequestParams } from "next-auth/providers/email";
import { Resend } from "resend";
import { prisma } from "@/lib/db/prisma";
import {
  isBetaEmailAllowed,
  isEmailAuthEnabled,
  maskEmail,
  normalizeEmailIdentifier
} from "@/lib/auth/email-access";
import { logger } from "@/lib/observability/logger";

export const EMAIL_MAGIC_LINK_MAX_AGE_SECONDS = 24 * 60 * 60;

export class MagicLinkRequestError extends Error {
  constructor(
    public status: number,
    public publicMessage: string
  ) {
    super(publicMessage);
  }
}

function getEmailFromAddress() {
  const from = process.env.EMAIL_FROM?.trim();
  if (!from) {
    throw new MagicLinkRequestError(500, "Email sign-in is not configured yet.");
  }

  return from;
}

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new MagicLinkRequestError(500, "Email sign-in is not configured yet.");
  }

  return new Resend(apiKey);
}

function buildMagicLinkHtml(url: string) {
  return `
<div style="font-family: Arial, sans-serif; color: #0b1020; line-height: 1.6;">
  <p>Sign in to Grounded Study.</p>
  <p>
    <a href="${url}" style="color: #0f766e;">Open your sign-in link</a>
  </p>
  <p>This link expires in 24 hours.</p>
  <p>If you didn't request this, you can ignore this email.</p>
</div>
`;
}

function buildMagicLinkText(url: string) {
  return [
    "Sign in to Grounded Study.",
    "",
    url,
    "",
    "This link expires in 24 hours.",
    "If you didn't request this, you can ignore this email."
  ].join("\n");
}

async function deliverMagicLinkEmail({
  identifier,
  url,
  expires
}: Pick<SendVerificationRequestParams, "identifier" | "url" | "expires">) {
  const resend = getResendClient();
  const response = await resend.emails.send({
    from: getEmailFromAddress(),
    to: identifier,
    subject: "Sign in to Grounded Study",
    text: buildMagicLinkText(url),
    html: buildMagicLinkHtml(url)
  });

  if (response.error) {
    logger.error(
      {
        email: maskEmail(identifier),
        error: response.error
      },
      "Magic link delivery failed"
    );
    throw new MagicLinkRequestError(500, "We couldn't send the sign-in email right now.");
  }

  logger.info(
    {
      email: maskEmail(identifier),
      expiresAt: expires.toISOString()
    },
    "Magic link sent"
  );
}

function hashVerificationToken(token: string) {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) {
    throw new MagicLinkRequestError(500, "Email sign-in is not configured yet.");
  }

  return createHash("sha256").update(`${token}${secret}`).digest("hex");
}

export function resolveAuthBaseUrl(request?: Request) {
  const origin = request?.headers.get("origin");
  if (origin) {
    return origin.replace(/\/$/, "");
  }

  const host = request?.headers.get("x-forwarded-host") ?? request?.headers.get("host");
  if (host) {
    const protocol =
      request?.headers.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
    return `${protocol}://${host}`;
  }

  return (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function safeSendVerificationRequest(params: SendVerificationRequestParams) {
  await deliverMagicLinkEmail(params);
}

export async function issueMagicLink({
  email,
  baseUrl,
  callbackUrl
}: {
  email: string;
  baseUrl: string;
  callbackUrl: string;
}) {
  if (!isEmailAuthEnabled()) {
    throw new MagicLinkRequestError(404, "Email sign-in is not enabled for this deployment.");
  }

  const normalizedEmail = normalizeEmailIdentifier(email);
  if (!isBetaEmailAllowed(normalizedEmail)) {
    logger.warn({ email: maskEmail(normalizedEmail) }, "Blocked magic link request outside beta allowlist");
    throw new MagicLinkRequestError(
      403,
      "Beta access is currently limited to approved email addresses."
    );
  }

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + EMAIL_MAGIC_LINK_MAX_AGE_SECONDS * 1000);
  const resolvedCallbackUrl = callbackUrl.startsWith("http")
    ? callbackUrl
    : `${baseUrl}${callbackUrl}`;
  const url = `${baseUrl}/api/auth/callback/email?${new URLSearchParams({
    callbackUrl: resolvedCallbackUrl,
    token,
    email: normalizedEmail
  }).toString()}`;

  await prisma.verificationToken.create({
    data: {
      identifier: normalizedEmail,
      token: hashVerificationToken(token),
      expires
    }
  });

  await deliverMagicLinkEmail({
    identifier: normalizedEmail,
    url,
    expires
  });

  return {
    email: normalizedEmail,
    expires
  };
}
