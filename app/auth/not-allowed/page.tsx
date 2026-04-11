import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function NotAllowedPage() {
  return (
    <div className="mx-auto max-w-2xl py-10">
      <Card className="border-ink/10 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
        <CardHeader>
          <CardTitle>Access not available yet</CardTitle>
          <CardDescription>
            This beta is currently limited to approved email addresses.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-ink/70">
          <p>
            If you expected access, please contact the Grounded Study team from the email address
            you used to sign in.
          </p>
          <Link href="/signin">
            <Button variant="outline">Back to sign in</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
