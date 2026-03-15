import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExamClient } from "@/app/dashboard/exam/exam-client";

export default function ExamPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Mock exam</CardTitle>
        <CardDescription>Test yourself using generated questions under exam-style conditions.</CardDescription>
      </CardHeader>
      <CardContent>
        <ExamClient />
      </CardContent>
    </Card>
  );
}
