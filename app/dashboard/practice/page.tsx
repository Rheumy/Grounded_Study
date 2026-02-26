import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PracticeClient } from "@/app/dashboard/practice/practice-client";

export default function PracticePage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Practice mode</CardTitle>
        <CardDescription>Instant feedback with citations and spaced repetition.</CardDescription>
      </CardHeader>
      <CardContent>
        <PracticeClient />
      </CardContent>
    </Card>
  );
}
