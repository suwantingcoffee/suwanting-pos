import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "min-h-10 w-full min-w-0 rounded-xl border bg-surface px-3 text-sm text-foreground placeholder:text-secondary focus:border-primary focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}
