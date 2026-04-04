import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PracticeClient } from "@/app/dashboard/practice/practice-client";

export default function PracticePage() {
  return (
    <Card className="border-ink/15 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
      <CardHeader>
        <CardTitle>Practice questions</CardTitle>
        <CardDescription>
          Build a focused practice session, work through each question, and finish with a clear
          summary of how you did.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <PracticeClient />
      </CardContent>
    </Card>
  );
}
