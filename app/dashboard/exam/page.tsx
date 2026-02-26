import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExamClient } from "@/app/dashboard/exam/exam-client";

export default function ExamPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Exam mode</CardTitle>
        <CardDescription>Timed sessions with configurable counts.</CardDescription>
      </CardHeader>
      <CardContent>
        <ExamClient />
      </CardContent>
    </Card>
  );
}
