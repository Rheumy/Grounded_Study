"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function BillingClient({
  stripeEnabled,
  plan,
  limits,
  usage
}: {
  stripeEnabled: boolean;
  plan: string;
  limits: { uploadsPerDay: number; questionsPerDay: number; storageMb: number };
  usage: { uploads: number; questions: number; storageBytes: number };
}) {
  const [status, setStatus] = useState<string | null>(null);

  const openCheckout = async () => {
    setStatus("Opening checkout...");
    const response = await fetch("/api/billing/checkout", { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus(body.error ?? "Checkout unavailable");
      return;
    }
    if (body.url) {
      window.location.href = body.url;
    }
  };

  const openPortal = async () => {
    setStatus("Opening portal...");
    const response = await fetch("/api/billing/portal", { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus(body.error ?? "Portal unavailable");
      return;
    }
    if (body.url) {
      window.location.href = body.url;
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-ink/10 p-3 text-sm">
        <p className="font-medium text-ink">Current plan: {plan}</p>
        <p className="text-ink/60">
          Uploads today: {usage.uploads}/{limits.uploadsPerDay}
        </p>
        <p className="text-ink/60">
          Questions today: {usage.questions}/{limits.questionsPerDay}
        </p>
        <p className="text-ink/60">
          Storage: {Math.round(usage.storageBytes / (1024 * 1024))}MB / {limits.storageMb}MB
        </p>
      </div>

      {!stripeEnabled ? (
        <p className="text-sm text-ink/60">Billing is disabled until Stripe keys are configured.</p>
      ) : (
        <div className="flex gap-3">
          <Button onClick={openCheckout}>Upgrade to Pro</Button>
          <Button variant="outline" onClick={openPortal}>Manage billing</Button>
        </div>
      )}

      {status ? <p className="text-sm text-ink/60">{status}</p> : null}
    </div>
  );
}
