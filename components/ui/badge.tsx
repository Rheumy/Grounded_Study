import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-accentSoft px-3 py-1 text-xs font-medium text-accent",
        className
      )}
      {...props}
    />
  );
}
