"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function AccountActions() {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteAccount = async () => {
    const confirmed = window.confirm(
      "Delete your account and all your study data? This cannot be undone."
    );
    if (!confirmed || deleting) {
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      const response = await fetch("/api/account", { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "We couldn't delete your account right now.");
        setDeleting(false);
        return;
      }

      await signOut({ callbackUrl: "/" });
    } catch {
      setError("We couldn't delete your account right now.");
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" onClick={() => signOut({ callbackUrl: "/" })}>
        Sign out
      </Button>
      <Button type="button" variant="danger" onClick={deleteAccount} disabled={deleting}>
        {deleting ? "Deleting..." : "Delete my account"}
      </Button>
      {error ? <p className="basis-full text-xs text-danger">{error}</p> : null}
    </div>
  );
}
