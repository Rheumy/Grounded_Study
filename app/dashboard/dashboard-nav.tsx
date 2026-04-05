"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
};

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardNav({
  items,
  showAdmin
}: {
  items: NavItem[];
  showAdmin: boolean;
}) {
  const pathname = usePathname();

  const links = showAdmin ? [...items, { href: "/dashboard/admin", label: "Admin" }] : items;

  return (
    <nav className="flex flex-col gap-1.5 text-sm">
      {links.map((item) => {
        const active = isActivePath(pathname, item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={[
              "rounded-xl border px-3 py-2.5 font-medium transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
              active
                ? "border-ink bg-ink text-white shadow-[0_16px_30px_-24px_rgba(15,23,42,0.8)]"
                : "border-transparent text-ink/70 hover:border-ink/10 hover:bg-ink/[0.035] hover:text-ink"
            ].join(" ")}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
