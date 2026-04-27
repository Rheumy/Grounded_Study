"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function VerifyRequestClient({ email }: { email: string | null }) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  const resend = async () => {
    if (resending) {
      return;
    }

    setResending(true);
    setStatus("Sending another sign-in link...");
    setError(null);

    try {
      const response = await fetch("/api/auth/resend-magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? "We couldn't resend the sign-in link. Please try again.");
        setStatus(null);
        return;
      }

      setStatus("A fresh sign-in link is on the way.");
    } catch {
      setError("We couldn't resend the sign-in link. Please try again.");
      setStatus(null);
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="space-y-4">
      <Button onClick={resend} variant="outline" className="w-full" disabled={resending}>
        {resending ? "Sending..." : "Resend link"}
      </Button>
      <div className="flex flex-col gap-2 text-sm">
        <Link href="/auth/signin" className="text-accent hover:underline">
          Back to sign in
        </Link>
        <Link href="/" className="text-accent hover:underline">
          Back to home
        </Link>
      </div>
      {status ? <p className="text-xs text-ink/60">{status}</p> : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

