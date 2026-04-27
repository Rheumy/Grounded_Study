const EMAIL_AUTH_ENABLED = process.env.NEXT_PUBLIC_EMAIL_AUTH_ENABLED === "true";

export function isEmailAuthEnabled() {
  return EMAIL_AUTH_ENABLED;
}

export function normalizeEmailIdentifier(identifier: string): string {
  const [local, rawDomain] = identifier.toLowerCase().trim().split("@");
  const domain = rawDomain?.split(",")[0]?.trim();

  if (!local || !domain) {
    throw new Error("Enter a valid email address.");
  }

  return `${local}@${domain}`;
}

export function getBetaAllowedEmails(): Set<string> | null {
  const raw = process.env.BETA_ALLOWED_EMAILS;
  if (!raw?.trim()) {
    return null;
  }

  const emails = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return emails.length > 0 ? new Set(emails) : null;
}

export function isBetaEmailAllowed(email: string | null | undefined): boolean {
  if (!email) {
    return false;
  }

  const allowedEmails = getBetaAllowedEmails();
  if (!allowedEmails) {
    return true;
  }

  return allowedEmails.has(email.trim().toLowerCase());
}

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) {
    return null;
  }

  const [local, domain] = email.trim().split("@");
  if (!local || !domain) {
    return "***";
  }

  const safeLocal = local.length > 1 ? `${local[0]}***` : `${local}***`;
  return `${safeLocal}@${domain}`;
}

