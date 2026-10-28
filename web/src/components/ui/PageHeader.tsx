/**
 * The top of a screen (S36, O-346): the page's one h1 and an optional line saying what the page
 * is for. Home, progress and settings share it so screens open the same way. A div, not a
 * <header>, so the app header stays the only banner landmark.
 */
import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Controls at the end of the header row (rare; most screens put controls in their cards). */
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
        {description === undefined ? null : <p className="text-sm text-muted md:text-base">{description}</p>}
      </div>
      {actions === undefined ? null : <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
