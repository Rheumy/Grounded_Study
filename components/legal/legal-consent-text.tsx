import Link from "next/link";

export function LegalConsentText() {
  return (
    <>
      I agree to the{" "}
      <Link href="/legal/terms" className="font-medium text-accent hover:underline">
        Terms of Service
      </Link>
      ,{" "}
      <Link href="/legal/privacy" className="font-medium text-accent hover:underline">
        Privacy Policy
      </Link>
      , and{" "}
      <Link href="/legal/acceptable-use" className="font-medium text-accent hover:underline">
        Acceptable Use Policy
      </Link>
      , and{" "}
      <Link href="/legal/copyright-takedown" className="font-medium text-accent hover:underline">
        Copyright Takedown Policy
      </Link>
      .
    </>
  );
}
