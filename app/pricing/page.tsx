import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { MarketingFooter } from "@/components/legal/marketing-footer";

export default function PricingPage() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-semibold text-ink">SULCAI private beta</h1>
        <p className="mt-2 text-ink/70">
          Access is free for the current controlled beta cohort. Daily safety limits still apply.
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Private beta</CardTitle>
            <CardDescription>No paid plan is active for this cohort.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="text-sm text-ink/70">
              <li>Controlled access for approved beta testers</li>
              <li>Daily upload and generation safety limits</li>
              <li>Practice + exam mode</li>
            </ul>
            <Link href="/auth/signin">
              <Button variant="outline">Sign in</Button>
            </Link>
          </CardContent>
        </Card>
        <Card className="border-accent/40">
          <CardHeader>
            <CardTitle>Paid plans</CardTitle>
            <CardDescription>Not available during this beta phase.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="text-sm text-ink/70">
              <li>No Stripe checkout for beta testers</li>
              <li>No upgrade required for the first cohort</li>
              <li>Pricing will be reviewed after usage data is measured</li>
            </ul>
            <Button disabled>Coming later</Button>
          </CardContent>
        </Card>
      </div>
      <MarketingFooter />
    </div>
  );
}
