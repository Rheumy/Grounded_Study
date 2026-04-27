"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/components/auth/auth-card";
import { LegalConsentText } from "@/components/legal/legal-consent-text";

export function LegalAcceptClient() {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!accepted || saving) {
      return;
    }

    setSaving(true);
    setStatus("Saving your confirmation...");
    setError(null);

    try {
      const response = await fetch("/api/legal/accept", {
        method: "POST"
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? "We could not save your confirmation. Please try again.");
        setStatus(null);
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("We could not save your confirmation. Please try again.");
      setStatus(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthCard
      title="Before you continue"
      description="Please confirm the upload and legal terms for this private beta account."
    >
      <label className="flex items-start gap-3 rounded-lg border border-ink/10 bg-ink/[0.02] p-4 text-sm text-ink/70">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
          className="mt-1 h-4 w-4 rounded border border-ink/20"
        />
        <span>
          <LegalConsentText />
        </span>
      </label>

      <Button onClick={submit} disabled={!accepted || saving} className="w-full">
        {saving ? "Saving..." : "Continue to dashboard"}
      </Button>

      {status ? <p className="text-xs text-ink/60">{status}</p> : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </AuthCard>
  );
}

