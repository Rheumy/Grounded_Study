import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth/options";
import Link from "next/link";

const navItems = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/documents", label: "Documents" },
  { href: "/dashboard/style-profiles", label: "Style Profiles" },
  { href: "/dashboard/generate", label: "Generate" },
  { href: "/dashboard/practice", label: "Practice" },
  { href: "/dashboard/exam", label: "Exam" },
  { href: "/dashboard/analytics", label: "Analytics" },
  { href: "/dashboard/billing", label: "Billing" }
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/signin");
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
      <aside className="space-y-2 rounded-xl border border-ink/10 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">Dashboard</p>
        <nav className="flex flex-col gap-2 text-sm">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="text-ink/70 hover:text-ink">
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <section className="min-w-0">{children}</section>
    </div>
  );
}
