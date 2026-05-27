import Link from "next/link";

export function MarketingFooter() {
  return (
    <footer className="border-t border-ink/10 pt-6">
      <div className="flex flex-wrap items-center gap-4 text-sm text-ink/60">
        <span>SULCAI private beta</span>
        <Link href="/legal/terms" className="hover:text-ink">
          Terms
        </Link>
        <Link href="/legal/privacy" className="hover:text-ink">
          Privacy
        </Link>
        <Link href="/legal/acceptable-use" className="hover:text-ink">
          Acceptable Use
        </Link>
      </div>
    </footer>
  );
}
