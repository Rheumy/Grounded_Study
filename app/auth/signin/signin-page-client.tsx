"use client";

import { useMemo, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LegalConsentText } from "@/components/legal/legal-consent-text";
import {
  LEGAL_CONSENT_COOKIE_NAME,
  LEGAL_VERSION,
  PENDING_MAGIC_LINK_EMAIL_COOKIE_NAME
} from "@/lib/constants/legal";

function setClientCookie(name: string, value: string, maxAgeSeconds: number) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
}

function getAuthErrorMessage(error: string | null) {
  switch (error) {
    case "AccessDenied":
      return "Beta access is currently limited to approved email addresses.";
    case "EmailSignin":
      return "We couldn't send the sign-in link. Please check your email address and try again.";
    case "OAuthSignin":
    case "OAuthCallback":
    case "Callback":
      return "We couldn't complete sign-in. Please try again.";
    default:
      return null;
  }
}

type MagicLinkResponse = {
  status?: "sent" | "blocked_allowlist" | "error";
  email?: string;
  error?: string;
};

export function SignInPageClient() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendingLink, setSendingLink] = useState(false);
  const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_ENABLED === "true";
  const emailAuthEnabled = process.env.NEXT_PUBLIC_EMAIL_AUTH_ENABLED === "true";
  const devBypassEnabled = process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "true";

  const queryError = useMemo(
    () => getAuthErrorMessage(searchParams.get("error")),
    [searchParams]
  );

  const persistConsent = () => {
    setClientCookie(LEGAL_CONSENT_COOKIE_NAME, LEGAL_VERSION, 60 * 60 * 24 * 30);
  };

  const persistPendingEmail = () => {
    const normalized = email.trim().toLowerCase();
    if (normalized) {
      setClientCookie(PENDING_MAGIC_LINK_EMAIL_COOKIE_NAME, normalized, 60 * 60 * 24);
    }
  };

  const submitMagicLink = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!acceptedLegal || sendingLink) {
      return;
    }

    setSendingLink(true);
    setStatus("Sending your sign-in link...");
    setError(null);

    persistConsent();
    persistPendingEmail();

    try {
      const response = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const body = (await response.json().catch(() => ({}))) as MagicLinkResponse;

      if (body.status === "sent") {
        window.location.href = "/auth/verify-request";
        return;
      }

      setStatus(null);
      setError(body.error ?? "We couldn't send the sign-in link. Please try again.");
    } catch {
      setStatus(null);
      setError("We couldn't send the sign-in link. Please try again.");
    } finally {
      setSendingLink(false);
    }
  };

  const startGoogleSignIn = async () => {
    if (!acceptedLegal) {
      return;
    }

    setError(null);
    setStatus(null);
    persistConsent();
    await signIn("google", { callbackUrl: "/dashboard" });
  };

  const startDevBypass = async () => {
    if (!acceptedLegal) {
      return;
    }

    setError(null);
    setStatus(null);
    persistConsent();
    await signIn("dev-bypass", { email, callbackUrl: "/dashboard" });
  };

  const authDisabled = !acceptedLegal;

  return (
    <AuthCard
      title="Sign in"
      description="Private beta access is limited to approved email addresses."
    >
      <label className="flex items-start gap-3 rounded-lg border border-ink/10 bg-ink/[0.02] p-4 text-sm text-ink/70">
        <input
          type="checkbox"
          checked={acceptedLegal}
          onChange={(event) => setAcceptedLegal(event.target.checked)}
          className="mt-1 h-4 w-4 rounded border border-ink/20"
        />
        <span>
          <LegalConsentText />
        </span>
      </label>

      {emailAuthEnabled ? (
        <form className="space-y-3" onSubmit={submitMagicLink}>
          <Input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <Button type="submit" className="w-full" disabled={authDisabled || sendingLink}>
            {sendingLink ? "Sending link..." : "Send magic link"}
          </Button>
        </form>
      ) : null}

      <Button
        variant="outline"
        className="w-full"
        onClick={startGoogleSignIn}
        disabled={authDisabled || !googleEnabled}
      >
        {googleEnabled ? "Continue with Google" : "Google OAuth not configured"}
      </Button>

      {devBypassEnabled ? (
        <Button
          variant="ghost"
          className="w-full"
          onClick={startDevBypass}
          disabled={authDisabled}
        >
          Dev bypass sign-in
        </Button>
      ) : null}

      {!acceptedLegal ? (
        <p className="text-xs text-ink/60">Please confirm the legal terms before continuing.</p>
      ) : null}
      {queryError ? <p className="text-xs text-danger">{queryError}</p> : null}
      {status ? <p className="text-xs text-ink/60">{status}</p> : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </AuthCard>
  );
}
