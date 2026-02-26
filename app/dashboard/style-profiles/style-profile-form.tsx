"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function StyleProfileForm() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(event.currentTarget);

    const response = await fetch("/api/style-profiles", {
      method: "POST",
      body: form
    });

    setLoading(false);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to create profile");
      return;
    }

    event.currentTarget.reset();
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Input name="name" placeholder="Profile name" required />
      <Textarea name="examplesText" placeholder="Paste sample questions or solution text" />
      <Input name="image" type="file" accept="image/*" />
      <Button type="submit" disabled={loading}>
        {loading ? "Creating..." : "Create style profile"}
      </Button>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </form>
  );
}
