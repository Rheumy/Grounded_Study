import { redirect } from "next/navigation";

export default function LegacySignInRedirect({
  searchParams
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const params = new URLSearchParams();

  Object.entries(searchParams ?? {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
      return;
    }

    if (typeof value === "string") {
      params.set(key, value);
    }
  });

  redirect(params.size > 0 ? `/auth/signin?${params.toString()}` : "/auth/signin");
}
