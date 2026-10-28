/**
 * The app's card (S36, O-346): a labelled region on the raised surface with a heading, an optional
 * one-line description, an optional row of controls beside the heading and the body. Home,
 * progress and settings all render their cards through it, so the depth is defined once.
 */
import { useId, type ReactNode } from "react";

import { cn } from "./cn.js";
import { RAISED_CLASS } from "./tactile.js";

export type CardHeadingLevel = 2 | 3;

export interface CardProps {
  title: string;
  description?: string;
  /** Controls beside the heading (a weeks selector, a link). */
  actions?: ReactNode;
  /** 2 by default; 3 for a card nested under a section heading. */
  headingLevel?: CardHeadingLevel;
  className?: string;
  testId?: string;
  children: ReactNode;
}

export function Card({ title, description, actions, headingLevel = 2, className, testId, children }: CardProps) {
  const headingId = useId();
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section
      aria-labelledby={headingId}
      data-testid={testId}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-2xl border border-border/50 bg-surface-raised p-4 sm:p-5",
        RAISED_CLASS,
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Heading id={headingId} className={headingLevel === 3 ? "text-base font-semibold" : "text-lg font-semibold tracking-tight"}>
          {title}
        </Heading>
        {actions === undefined ? null : <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {description === undefined ? null : <p className="-mt-2 text-sm text-muted">{description}</p>}
      {children}
    </section>
  );
}
