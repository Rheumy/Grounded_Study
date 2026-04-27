export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-md flex-col gap-6 py-8">{children}</div>;
}

