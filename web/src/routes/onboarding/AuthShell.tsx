/**
 * The centred column the sign-in and join screens share (S42, R3.13, O-349): a plain page, one
 * narrow column, a heading, an optional line under it, then the step. Monochrome restraint on the
 * S36 palette: the raised Panel is the only surface, the primary Button the only accent.
 */
import type { ReactNode } from "react";

import { cn, Panel } from "../../components/ui/index.js";

export interface AuthShellProps {
  title: string;
  /** A line under the heading, such as the email chip. */
  subtitle?: ReactNode;
  children: ReactNode;
}

export function AuthShell({ title, subtitle, children }: AuthShellProps) {
  return (
    <main className="flex min-h-dvh items-start justify-center px-4 pt-16 pb-8 sm:pt-24">
      <div className="flex w-full max-w-sm flex-col gap-5">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle}
        </div>
        <Panel className="gap-4">{children}</Panel>
      </div>
    </main>
  );
}

export interface EmailChipProps {
  email: string;
}

/** The known email as a small read-only chip under the heading. */
export function EmailChip({ email }: EmailChipProps) {
  return (
    <p data-testid="email-chip" className="max-w-full truncate rounded-full border border-border px-3 py-1 text-sm text-muted">
      {email}
    </p>
  );
}

export interface SpinnerProps {
  className?: string;
}

/** A small spinning ring; it stands still under reduced motion and is hidden from screen readers. */
export function Spinner({ className }: SpinnerProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none",
        className,
      )}
    />
  );
}
