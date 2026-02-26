import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Page() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Coming soon</CardTitle>
        <CardDescription>This section will be implemented in upcoming slices.</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-ink/60">
        This is a secure placeholder so routing and auth checks work end-to-end.
      </CardContent>
    </Card>
  );
}
