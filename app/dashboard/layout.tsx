import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth/options";
import Link from "next/link";

const navItems = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/documents", label: "Study Materials" },
  { href: "/dashboard/style-profiles", label: "Question Format" },
  { href: "/dashboard/generate", label: "Generate Questions" },
  { href: "/dashboard/practice", label: "Practice Questions" },
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
    <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
      <aside className="space-y-4 rounded-2xl border border-ink/10 bg-white p-4 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/45">Dashboard</p>
          <p className="text-sm text-ink/60">Move between study setup, practice, and review.</p>
        </div>
        <nav className="flex flex-col gap-2 text-sm">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-xl px-3 py-2 text-ink/70 transition hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              {item.label}
            </Link>
          ))}
          {isAdmin ? (
            <Link
              href="/dashboard/admin"
              className="rounded-xl px-3 py-2 text-ink/70 transition hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              Admin
            </Link>
          ) : null}
        </nav>
      </aside>
      <section className="min-w-0">{children}</section>
    </div>
  );
}
