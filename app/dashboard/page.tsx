import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/options";

const dashboardCards = [
  {
    href: "/dashboard/documents",
    eyebrow: "Step 1",
    title: "Study materials",
    description: "Upload notes, slides, textbook chapters, or revision files.",
    cta: "Upload study material"
  },
  {
    href: "/dashboard/style-profiles",
    eyebrow: "Step 2",
    title: "Question style",
    description: "Tell us what kind of questions you want, or add examples from your exam.",
    cta: "Set question style"
  },
  {
    href: "/dashboard/generate",
    eyebrow: "Step 3",
    title: "Generate questions",
    description: "Create your question bank from your uploaded study material.",
    cta: "Generate your question bank"
  },
  {
    href: "/dashboard/practice",
    eyebrow: "Step 4",
    title: "Practice",
    description: "Practise your generated questions.",
    cta: "Practise these questions"
  },
  {
    href: "/dashboard/exam",
    eyebrow: "Step 4",
    title: "Mock exam",
    description: "Test yourself under exam conditions.",
    cta: "Start a mock exam"
  },
  {
    href: "/dashboard/analytics",
    eyebrow: "Review",
    title: "Progress",
    description: "Review your results and weak areas.",
    cta: "View progress"
  }
];

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-ink/10 bg-white p-7 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/45">Start here</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Build your study workflow
        </h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-ink/65">
          Follow the steps from study material to question bank, practice, and mock exams.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/dashboard/documents"
            className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-white transition hover:bg-accent/90"
          >
            First time here? Upload your study material
          </Link>
          <Link
            href="/dashboard/style-profiles"
            className="inline-flex h-10 items-center justify-center rounded-md border border-ink/20 px-4 text-sm font-medium text-ink transition hover:bg-ink/5"
          >
            Or start with your question style
          </Link>
        </div>
        <p className="mt-5 text-sm text-ink/50">Signed in as {session?.user?.email}</p>
      </div>

      <div className="grid gap-3 rounded-2xl border border-ink/10 bg-ink/[0.02] p-5 text-sm text-ink/75 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <p className="font-medium text-ink">Step 1</p>
          <p className="mt-1">Upload study material</p>
        </div>
        <div>
          <p className="font-medium text-ink">Step 2</p>
          <p className="mt-1">Tell us what kind of questions you want</p>
        </div>
        <div>
          <p className="font-medium text-ink">Step 3</p>
          <p className="mt-1">Generate your question bank</p>
        </div>
        <div>
          <p className="font-medium text-ink">Step 4</p>
          <p className="mt-1">Practise or sit a mock exam</p>
        </div>
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
