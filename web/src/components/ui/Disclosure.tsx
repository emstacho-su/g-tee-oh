/**
 * Disclosure: a section that expands and collapses inline (S38, R3.13, O-387, O-388). The owner's
 * review asked for drill-down that "just expands and collapses" instead of a pop-out that must be
 * closed, so the feedback panel's sections, and any later screen's, use this one primitive.
 *
 * Mechanism: the title is a button inside a heading (so screen reader users can jump between
 * sections by heading) with aria-expanded and aria-controls naming the body, which is a region
 * labelled by the button. It works controlled (open with onOpenChange, so a screen can remember
 * the choice) or uncontrolled (defaultOpen). The body mounts on the first open and stays mounted
 * after (lazy, the default), so a section that reads the api reads it only when wanted and never
 * again on reopen; a closed body is hidden from everyone with the hidden attribute. Opening grows
 * the body in place through a CSS grid-rows transition from 0fr to 1fr; reduced motion turns the
 * transition off, and closing is immediate. The button takes the shared tactile press and the
 * checked control edge (O-364, O-369); an optional hint sits beside the title, inside its name.
 */
import { useId, useState, type ReactNode } from "react";

import { cn } from "./cn.js";
import { CONTROL_EDGE_CLASS, FLAT_REST_CLASS, TACTILE_CLASS } from "./tactile.js";

export type DisclosureHeadingLevel = 2 | 3 | 4;

export interface DisclosureProps {
  title: string;
  /** A short hint beside the title, for example "Roll 37"; part of the button's name. */
  hint?: ReactNode;
  /** Controlled open state; pair with onOpenChange. */
  open?: boolean;
  /** The first state when uncontrolled. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Mount the body only on the first open (default true); false renders it hidden from the start. */
  lazy?: boolean;
  headingLevel?: DisclosureHeadingLevel;
  testId?: string;
  className?: string;
  children: ReactNode;
}

const HEADINGS = { 2: "h2", 3: "h3", 4: "h4" } as const;

const BUTTON_CLASSES = cn(
  "flex w-full items-center gap-2 rounded-lg bg-surface-raised px-3 py-2 text-left text-sm font-semibold text-text hover:bg-surface",
  TACTILE_CLASS,
  FLAT_REST_CLASS,
  CONTROL_EDGE_CLASS,
);

/** A chevron that points right when closed and down when open; the words carry the state too. */
function Chevron({ open }: { open: boolean }) {
  return (
    <span aria-hidden="true" className={cn("ml-auto inline-block text-muted transition-transform motion-reduce:transition-none", open && "rotate-90")}>
      ›
    </span>
  );
}

export function Disclosure({
  title,
  hint,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  lazy = true,
  headingLevel = 3,
  testId,
  className,
  children,
}: DisclosureProps) {
  const buttonId = useId();
  const bodyId = useId();
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const open = controlledOpen ?? ownOpen;
  const [everOpened, setEverOpened] = useState(open);
  if (open && !everOpened) setEverOpened(true);
  const mounted = !lazy || open || everOpened;
  const Heading = HEADINGS[headingLevel];

  const toggle = () => {
    const next = !open;
    if (controlledOpen === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };

  return (
    <section data-testid={testId} data-open={String(open)} className={cn("flex flex-col gap-2", className)}>
      <Heading className="m-0 text-base">
        <button id={buttonId} type="button" aria-expanded={open} aria-controls={bodyId} onClick={toggle} className={BUTTON_CLASSES}>
          <span>{title}</span>
          {hint === undefined ? null : (
            <>
              {" "}
              <span className="font-normal text-muted tabular-nums">{hint}</span>
            </>
          )}
          <Chevron open={open} />
        </button>
      </Heading>
      <div
        data-testid="disclosure-track"
        data-open={String(open)}
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div id={bodyId} role="region" aria-labelledby={buttonId} hidden={!open} className="min-h-0 min-w-0 overflow-hidden">
          {mounted ? children : null}
        </div>
      </div>
    </section>
  );
}
