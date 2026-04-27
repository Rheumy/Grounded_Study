import { cookies } from "next/headers";
import { AuthCard } from "@/components/auth/auth-card";
import { VerifyRequestClient } from "@/app/auth/verify-request/verify-request-client";
import { PENDING_MAGIC_LINK_EMAIL_COOKIE_NAME } from "@/lib/constants/legal";

export default function VerifyRequestPage() {
  const rawEmail = cookies().get(PENDING_MAGIC_LINK_EMAIL_COOKIE_NAME)?.value ?? null;
  const email = rawEmail ? decodeURIComponent(rawEmail) : null;

  return (
    <AuthCard title="Check your email">
      <div className="space-y-3 text-sm text-ink/70">
        <p>
          {email ? (
            <>
              We sent a sign-in link to <span className="font-medium text-ink">{email}</span>.
            </>
          ) : (
            "We sent a sign-in link to your email address."
          )}
        </p>
        <p className="text-ink/55">
          It can take a minute to arrive. Check your spam folder if you do not see it.
        </p>
      </div>
      <VerifyRequestClient email={email} />
    </AuthCard>
  );
}
