import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";

export default function NotAllowedPage() {
  return (
    <AuthCard
      title="Access not available yet"
      description="This beta is currently limited to approved email addresses."
    >
      <p className="text-sm text-ink/70">
        If you expected access, please contact the SULCAI team from the email address you
        used to sign in.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/auth/signin">
          <Button variant="outline">Back to sign in</Button>
        </Link>
        <Link href="/">
          <Button variant="ghost">Back to home</Button>
        </Link>
      </div>
    </AuthCard>
  );
}
