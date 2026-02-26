"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_ENABLED === "true";
  const devBypassEnabled = process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "true";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus("Sending magic link request...");
    await signIn("email", { email, callbackUrl: "/dashboard" });
    setStatus("If configured, a magic link was requested. Check docs for dev bypass.");
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Use your email. Google OAuth appears if configured.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="space-y-3" onSubmit={submit}>
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <Button type="submit" className="w-full">
              Send magic link
            </Button>
          </form>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
            disabled={!googleEnabled}
          >
            {googleEnabled ? "Continue with Google" : "Google OAuth not configured"}
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => signIn("dev-bypass", { email, callbackUrl: "/dashboard" })}
            disabled={!devBypassEnabled}
          >
            {devBypassEnabled ? "Dev bypass sign-in" : "Dev bypass disabled"}
          </Button>
          {status ? <p className="text-xs text-ink/60">{status}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
