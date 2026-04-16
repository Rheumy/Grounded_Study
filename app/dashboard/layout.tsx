import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth/options";
import { DashboardNav } from "@/app/dashboard/dashboard-nav";

const navItems = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/documents", label: "Study Materials" },
  { href: "/dashboard/style-profiles", label: "Question Style" },
  { href: "/dashboard/generate", label: "Create Questions" },
  { href: "/dashboard/practice", label: "Practice" },
  { href: "/dashboard/exam", label: "Mock Exam" },
  { href: "/dashboard/analytics", label: "Progress" },
  { href: "/dashboard/billing", label: "Billing" }
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/signin");
  }

  const isAdmin = (session.user as { isAdmin?: boolean } | undefined)?.isAdmin ?? false;

  return (
    <div className="grid gap-6 lg:grid-cols-[230px_1fr] xl:gap-8">
      <aside className="h-fit space-y-4 rounded-2xl border border-ink/10 bg-white p-4 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)] lg:sticky lg:top-6">
        <div className="space-y-1.5 border-b border-ink/8 pb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/45">Dashboard</p>
          <p className="text-sm leading-6 text-ink/60">
            Follow the steps from study material to practice and review.
          </p>
        </div>
        <DashboardNav items={navItems} showAdmin={isAdmin} />
      </aside>
      <section className="min-w-0">{children}</section>
    </div>
  );
}
