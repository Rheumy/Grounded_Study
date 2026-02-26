import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function PricingPage() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-semibold text-ink">Plans</h1>
        <p className="mt-2 text-ink/70">Start free, upgrade when you need more questions and storage.</p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Free</CardTitle>
            <CardDescription>For lightweight study sessions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="text-sm text-ink/70">
              <li>Up to 3 documents</li>
              <li>20 questions / day</li>
              <li>Practice + exam mode</li>
            </ul>
            <Link href="/signin">
              <Button variant="outline">Get started</Button>
            </Link>
          </CardContent>
        </Card>
        <Card className="border-accent/40">
          <CardHeader>
            <CardTitle>Pro</CardTitle>
            <CardDescription>More storage, larger exams, advanced analytics.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="text-sm text-ink/70">
              <li>50 documents</li>
              <li>200 questions / day</li>
              <li>Priority generation</li>
            </ul>
            <Link href="/dashboard/billing">
              <Button>Upgrade</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
