import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HomepageDemo } from "@/components/home/homepage-demo";
import { MarketingFooter } from "@/components/legal/marketing-footer";

export default function HomePage() {
  const features = [
    {
      number: "01",
      title: "Cited, not made up.",
      description: "Every question links back to the page it came from."
    },
    {
      number: "02",
      title: "Verified before you see it.",
      description: "A second pass blocks unsupported or ambiguous questions."
    },
    {
      number: "03",
      title: "Built for real exams.",
      description: "Difficulty tuning that mirrors how board and entrance exams actually test."
    }
  ];

  return (
    <div className="space-y-16">
      <section className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="space-y-6">
          <Badge>Private beta</Badge>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-ink/45">SULCAI</p>
          <h1 className="text-4xl font-semibold text-ink sm:text-5xl">
            Practice questions from your own notes.
          </h1>
          <p className="text-lg text-ink/70">
            Upload your PDFs. Get exam questions that cite the page they came from. Every answer is
            checked before you see it.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/auth/signin">
              <Button size="lg">Enter private beta</Button>
            </Link>
          </div>
        </div>
        <HomepageDemo />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {features.map((feature) => (
          <div key={feature.number} className="rounded-3xl border border-ink/10 bg-fog p-6">
            <h2 className="text-xl font-semibold text-ink">{`${feature.number} — ${feature.title}`}</h2>
            <p className="mt-3 text-sm leading-6 text-ink/70">{feature.description}</p>
          </div>
        ))}
      </section>

      <MarketingFooter />
    </div>
  );
}
