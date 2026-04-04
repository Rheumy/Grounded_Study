import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExamClient } from "@/app/dashboard/exam/exam-client";

export default function ExamPage() {
  return (
    <Card className="border-ink/15 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
      <CardHeader>
        <CardTitle>Mock exam</CardTitle>
        <CardDescription>
          Test yourself under exam-style conditions, then review every answer with grounded
          explanations after submission.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ExamClient />
      </CardContent>
    </Card>
  );
}
