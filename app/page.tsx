import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function HomePage() {
  return (
    <div className="space-y-16">
      <section className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <Badge>Grounded practice, less hallucination</Badge>
          <h1 className="text-4xl font-semibold text-ink sm:text-5xl">
            Turn your textbooks and notes into verified practice exams.
          </h1>
          <p className="text-lg text-ink/70">
            Grounded Study ingests your PDFs and screenshots, builds a citation-backed knowledge base, and
            generates practice questions that always cite their sources.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/signin">
              <Button size="lg">Get started</Button>
            </Link>
            <Link href="/pricing">
              <Button variant="outline" size="lg">See plans</Button>
            </Link>
          </div>
        </div>
        <Card className="border-accent/20 bg-gradient-to-br from-white to-accentSoft">
          <CardHeader>
            <CardTitle>Evidence-first generation</CardTitle>
            <CardDescription>
              Every question stores citations and a verifier pass. If evidence is missing, we regenerate or
              mark it as insufficient.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-ink/70">
            <p>Upload PDFs, slides, screenshots, or handwritten notes.</p>
            <p>Control difficulty with Bloom-level and distractor tuning.</p>
            <p>Practice questions, mock exams, progress tracking, and spaced revision.</p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        {[
          {
            title: "Grounded Retrieval",
            description: "Vector search over pgvector with strict citations on every answer."
          },
          {
            title: "Verification Pass",
            description: "LLM verifier blocks unsupported questions before they reach students."
          },
          {
            title: "Secure by Default",
            description: "Private storage, strict file validation, rate limits, and audit logs."
          }
        ].map((feature) => (
          <Card key={feature.title}>
            <CardHeader>
              <CardTitle>{feature.title}</CardTitle>
              <CardDescription>{feature.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>
    </div>
  );
}
