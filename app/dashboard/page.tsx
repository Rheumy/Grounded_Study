import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/options";

const dashboardCards = [
  {
    href: "/dashboard/documents",
    eyebrow: "Study setup",
    title: "Study materials",
    description: "Upload source material and keep track of what is ready for question generation.",
    cta: "Open materials"
  },
  {
    href: "/dashboard/style-profiles",
    eyebrow: "Question design",
    title: "Question format",
    description: "Capture the style, level, and marking guidance that should shape your questions.",
    cta: "Open question format"
  },
  {
    href: "/dashboard/generate",
    eyebrow: "Build",
    title: "Generate questions",
    description: "Create grounded MCQ, true/false, and short-answer questions from ready materials.",
    cta: "Generate now"
  },
  {
    href: "/dashboard/practice",
    eyebrow: "Train",
    title: "Practice questions",
    description: "Run focused practice sessions with cleaner feedback and session summaries.",
    cta: "Start practice"
  },
  {
    href: "/dashboard/exam",
    eyebrow: "Simulate",
    title: "Mock exam",
    description: "Test yourself under exam conditions and review each answer after submission.",
    cta: "Open mock exam"
  },
  {
    href: "/dashboard/analytics",
    eyebrow: "Review",
    title: "Progress",
    description: "See where you are improving and where you may need more revision.",
    cta: "View progress"
  }
];

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-ink/10 bg-ink/[0.02] p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/45">Overview</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Grounded Study workspace</h1>
        <p className="mt-2 max-w-3xl text-sm text-ink/65">
          Move from source material to generation, practice, and review without losing the grounded
          evidence behind each question.
        </p>
        <p className="mt-4 text-sm text-ink/50">Signed in as {session?.user?.email}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {dashboardCards.map((card) => (
          <Link key={card.href} href={card.href} className="group">
            <Card className="h-full border-ink/12 bg-white transition duration-200 hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-[0_22px_45px_-34px_rgba(15,23,42,0.45)]">
              <CardContent className="flex h-full flex-col justify-between space-y-6 p-0">
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">{card.eyebrow}</p>
                  <div className="space-y-2">
                    <h2 className="text-xl font-semibold tracking-tight text-ink">{card.title}</h2>
                    <p className="text-sm leading-6 text-ink/65">{card.description}</p>
                  </div>
                </div>
                <p className="text-sm font-medium text-accent transition group-hover:translate-x-0.5">
                  {card.cta}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
