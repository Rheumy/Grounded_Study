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
      <div className="rounded-2xl border border-ink/10 bg-white p-7 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/45">Overview</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Grounded Study workspace
        </h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-ink/65">
          Move from study material to question generation, practice, and review in one clear flow.
        </p>
        <p className="mt-5 text-sm text-ink/50">Signed in as {session?.user?.email}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {dashboardCards.map((card) => (
          <Link key={card.href} href={card.href} className="group">
            <Card className="h-full border-ink/12 bg-white transition duration-200 hover:-translate-y-0.5 hover:border-ink/20 hover:shadow-[0_22px_45px_-34px_rgba(15,23,42,0.45)]">
              <CardContent className="flex h-full flex-col justify-between space-y-8 p-5">
                <div className="space-y-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">{card.eyebrow}</p>
                  <div className="space-y-2.5">
                    <h2 className="text-[1.35rem] font-semibold tracking-tight text-ink">{card.title}</h2>
                    <p className="text-sm leading-6 text-ink/65">{card.description}</p>
                  </div>
                </div>
                <p className="text-sm font-medium text-ink transition group-hover:translate-x-0.5">
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
