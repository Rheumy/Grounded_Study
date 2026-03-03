import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/options";
import { Button } from "@/components/ui/button";

export async function SiteNav() {
  const session = await getServerSession(authOptions);

  return (
    <header className="border-b border-ink/10 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" className="text-lg font-semibold text-ink">
          Grounded Study
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/pricing" className="text-ink/70 hover:text-ink">
            Pricing
          </Link>
          <Link href="/dashboard" className="text-ink/70 hover:text-ink">
            Dashboard
          </Link>
          {session ? (
            <form action="/api/auth/signout" method="post">
              <Button variant="outline" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          ) : (
            <Link href="/signin">
              <Button size="sm">Sign in</Button>
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
