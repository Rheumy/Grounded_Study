import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PracticeClient } from "@/app/dashboard/practice/practice-client";

export default function PracticePage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Practice questions</CardTitle>
        <CardDescription>Review your questions with feedback and revision tracking.</CardDescription>
      </CardHeader>
      <CardContent>
        <PracticeClient />
      </CardContent>
    </Card>
  );
}
