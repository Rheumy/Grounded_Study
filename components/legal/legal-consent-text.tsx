import Link from "next/link";

export function LegalConsentText() {
  return (
    <>
      I confirm I have the right to upload material I add to Grounded Study and will not upload
      pirated, infringing, or unlawfully obtained content. I have read and agree to the{" "}
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
      .
    </>
  );
}

