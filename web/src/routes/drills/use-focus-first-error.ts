/**
 * After a failed Save, the first error gets the focus (S47, R3.14, O-483): the builder moves to the
 * first page that holds a field error (the section list's order) and focuses that page's first
 * invalid control, so the user lands on what to fix instead of reading the alert and hunting.
 *
 * Mechanism: the form's submit handler asks for the focus with the error counts by page; when the
 * first marked page is not the open one, the hook navigates to it (the form stays mounted across
 * pages of one drill, DrillBuilderPage). An effect then looks for the first [aria-invalid="true"]
 * inside the form and focuses it, on the next render when the page is already open or after the
 * navigation lands; fieldsets take focus through their tabIndex of -1 (form-parts.tsx).
 */
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type RefObject } from "react";

import { describeFailureForLog } from "../../api/http-status.js";
import { BUILDER_SECTIONS, type BuilderSectionSlug } from "../../drills/builder-sections.js";
import type { SectionErrorCounts } from "./BuilderNav.js";

const INVALID_CONTROL = '[aria-invalid="true"]';

export function useFocusFirstError(section: BuilderSectionSlug, drillId: string | undefined, form: RefObject<HTMLFormElement | null>): (counts: SectionErrorCounts) => void {
  const navigate = useNavigate();
  // The page whose first invalid control should take the focus, or null when nothing is pending.
  const [pending, setPending] = useState<BuilderSectionSlug | null>(null);

  useEffect(() => {
    // Wait until the pending page is the open one: the page left behind may hold an invalid field too.
    if (pending === null || pending !== section) return;
    const target = form.current?.querySelector<HTMLElement>(INVALID_CONTROL);
    if (target === null || target === undefined) return;
    target.focus();
    setPending(null);
  }, [pending, section, form]);

  return (counts) => {
    const first = BUILDER_SECTIONS.find((entry) => (counts[entry.slug] ?? 0) > 0);
    if (first === undefined) return;
    setPending(first.slug);
    if (first.slug === section) return;
    const move =
      drillId === undefined
        ? navigate({ to: "/drills/new/$section", params: { section: first.slug } })
        : navigate({ to: "/drills/$id/$section", params: { id: drillId, section: first.slug } });
    move.catch((error: unknown) => {
      console.error(`g-tee-oh: moving to the first page with an error failed (${describeFailureForLog(error)})`);
    });
  };
}
