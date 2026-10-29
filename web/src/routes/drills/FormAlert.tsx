/**
 * The builder's form alert (S26, R3.14; S40, O-405): shown after Save when the draft has errors or
 * the save failed. Its first line starts "Error:" (the failure sentence, or the fix line); then a
 * link to each builder page that holds field errors, named with its count ("Game: 2 fields to
 * fix"), so an error on a page that is not open is one click away; then the errors that name no
 * field and the api's omitted count (ErrorList, PR #30 review MEDIUM 1).
 */
import { Link } from "@tanstack/react-router";

import { BUILDER_SECTIONS, type BuilderSectionEntry } from "../../drills/builder-sections.js";
import type { GroupedErrors } from "../../drills/field-errors.js";
import type { SectionErrorCounts } from "./BuilderNav.js";
import { ErrorList } from "./ErrorList.js";

export const ALERT_TEXT = {
  fix: "Fix the fields marked below.",
  pages: "Pages with fields to fix",
} as const;

export interface FormAlertProps {
  errors: GroupedErrors;
  counts: SectionErrorCounts;
  failure: string | null;
  /** The api's field errors left out of the bounded list (MEDIUM 1). */
  omitted: number;
  /** The stored drill; undefined for the new drill. */
  drillId: string | undefined;
}

function fixText(section: BuilderSectionEntry, count: number): string {
  return `${section.label}: ${count} ${count === 1 ? "field" : "fields"} to fix`;
}

function PageLink({ drillId, section, count }: { drillId: string | undefined; section: BuilderSectionEntry; count: number }) {
  const text = fixText(section, count);
  if (drillId === undefined) {
    return (
      <Link to="/drills/new/$section" params={{ section: section.slug }} className="underline">
        {text}
      </Link>
    );
  }
  return (
    <Link to="/drills/$id/$section" params={{ id: drillId, section: section.slug }} className="underline">
      {text}
    </Link>
  );
}

export function FormAlert({ errors, counts, failure, omitted, drillId }: FormAlertProps) {
  const formMessages = errors.form ?? [];
  const marked = BUILDER_SECTIONS.filter((section) => (counts[section.slug] ?? 0) > 0);
  if (failure === null && formMessages.length === 0 && marked.length === 0 && omitted === 0) return null;
  return (
    <div role="alert" data-testid="form-alert" className="flex flex-col gap-2 rounded-xl border border-danger bg-surface-raised p-3 text-sm">
      <p className="font-semibold text-danger">{`Error: ${failure ?? ALERT_TEXT.fix}`}</p>
      {marked.length === 0 ? null : (
        <ul aria-label={ALERT_TEXT.pages} className="flex flex-col gap-1">
          {marked.map((section) => (
            <li key={section.slug}>
              <PageLink drillId={drillId} section={section} count={counts[section.slug] ?? 0} />
            </li>
          ))}
        </ul>
      )}
      <ErrorList lines={formMessages} omitted={omitted} />
    </div>
  );
}
