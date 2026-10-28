/**
 * The frame every progress card shares (S32, R4.12): a labelled section with a heading, an
 * optional line of actions beside it and the body. The /progress screen and the home cards use it,
 * so the two screens read as one system.
 */
import { useId, type ReactNode } from "react";

import { cn } from "../ui/index.js";

export interface ProgressCardProps {
  title: string;
  /** Controls beside the heading (a weeks selector, a table toggle). */
  actions?: ReactNode;
  className?: string;
  testId?: string;
  children: ReactNode;
}

export function ProgressCard({ title, actions, className, testId, children }: ProgressCardProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-testid={testId}
      className={cn("flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-lg font-semibold">
          {title}
        </h2>
        {actions === undefined ? null : <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
