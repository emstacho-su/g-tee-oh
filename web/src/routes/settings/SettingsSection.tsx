/**
 * The frame of one /settings section (S32, A7 section 2): a labelled region with a heading, an
 * optional one-line description and the body, styled like the other settings cards.
 */
import { useId, type ReactNode } from "react";

export interface SettingsSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4">
      <h2 id={headingId} className="text-lg font-semibold">
        {title}
      </h2>
      {description === undefined ? null : <p className="text-sm text-muted">{description}</p>}
      {children}
    </section>
  );
}
