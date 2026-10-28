/**
 * InfoTip: a small info button that explains a term (S38, R3.12, O-368, screen review row 14).
 *
 * Mechanism: a round "i" button named "About <subject>" over Radix Tooltip with a controlled open
 * state, so it opens every way a person can reach it: hover (Radix, after a short delay), keyboard
 * focus (Radix), and click or tap, which toggles it (touch screens have no hover, and Radix closes a
 * tooltip on click, so this button handles click itself and stops Radix's handler). A press
 * anywhere outside the button and the tip closes it, as does Escape. The explanation is also in
 * the DOM at all times as visually hidden text the button names through aria-describedby, so a
 * screen reader reads it on focus without opening anything. The tip is rendered into the nearest
 * dialog when the button sits in one, otherwise into the body, so a dialog never paints over it
 * and it never nests a block inside the caller's inline text; it takes the tooltip layer
 * (layers.ts). Each InfoTip brings its own TooltipProvider, so callers need none.
 */
import * as Tooltip from "@radix-ui/react-tooltip";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject, type SyntheticEvent } from "react";

import { cn } from "./cn.js";
import { TOOLTIP_LAYER_CLASS } from "./layers.js";
import { CONTROL_EDGE_CLASS, FLAT_REST_CLASS, TACTILE_CLASS } from "./tactile.js";

export interface InfoTipProps {
  /** What the tip explains, read as "About <subject>": "actions", "the strongest folding hand". */
  subject: string;
  /** The explanation: one or two plain sentences. */
  children: ReactNode;
  className?: string;
}

/** Hover waits this long before opening, so moving the pointer across a card does not flash tips. */
const HOVER_DELAY_MS = 200;
const DIALOG_SELECTOR = '[role="dialog"]';

const TRIGGER_CLASSES = cn(
  "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-raised align-middle font-serif text-xs font-bold italic text-muted",
  CONTROL_EDGE_CLASS,
  TACTILE_CLASS,
  FLAT_REST_CLASS,
);

const CONTENT_CLASSES = cn(
  "max-w-72 rounded-lg bg-text px-3 py-2 text-sm font-normal not-italic leading-snug text-surface shadow-lg",
  TOOLTIP_LAYER_CLASS,
);

/** Stops Radix's own handler for this event, which runs after ours unless the default is prevented. */
function stopRadix(event: SyntheticEvent): void {
  event.preventDefault();
}

/** Closes the tip on a press outside the button and the tip, while it is open. */
function useOutsidePress(open: boolean, inside: readonly RefObject<HTMLElement | null>[], close: () => void): void {
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && inside.some((ref) => ref.current?.contains(target) === true)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, inside, close]);
}

export function InfoTip({ subject, children, className }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pressing = useRef(false);
  const textId = useId();
  const close = useRef(() => setOpen(false)).current;
  const inside = useRef([triggerRef, contentRef] as const).current;
  useOutsidePress(open, inside, close);

  const changeOpen = (next: boolean) => {
    if (next) setContainer(triggerRef.current?.closest<HTMLElement>(DIALOG_SELECTOR) ?? document.body);
    setOpen(next);
  };

  return (
    <Tooltip.Provider delayDuration={HOVER_DELAY_MS}>
      <Tooltip.Root open={open} onOpenChange={changeOpen}>
        <Tooltip.Trigger
          ref={triggerRef}
          type="button"
          aria-label={`About ${subject}`}
          aria-describedby={textId}
          aria-expanded={open}
          className={cn(TRIGGER_CLASSES, className)}
          onPointerDown={(event) => {
            pressing.current = true;
            // A press that ends anywhere (released off the button, or cancelled) ends here too, so a
            // later keyboard focus still opens the tip (review round 1, 8). Focus from the press
            // itself comes before the release, so it is still held back.
            const release = () => {
              pressing.current = false;
              window.removeEventListener("pointerup", release, true);
              window.removeEventListener("pointercancel", release, true);
            };
            window.addEventListener("pointerup", release, true);
            window.addEventListener("pointercancel", release, true);
            stopRadix(event);
          }}
          onFocus={(event) => {
            // A press toggles on click; focus from that same press must not open it first.
            if (pressing.current) stopRadix(event);
          }}
          onBlur={() => {
            pressing.current = false;
          }}
          onClick={(event) => {
            pressing.current = false;
            stopRadix(event);
            changeOpen(!open);
          }}
        >
          <span aria-hidden="true">i</span>
        </Tooltip.Trigger>
        <VisuallyHidden id={textId} data-info-tip-text="">
          {children}
        </VisuallyHidden>
        <Tooltip.Portal container={container}>
          <Tooltip.Content
            ref={contentRef}
            data-info-tip-content=""
            side="top"
            sideOffset={6}
            collisionPadding={8}
            className={CONTENT_CLASSES}
            // The outside press is handled above, so a press on the button itself only toggles.
            onPointerDownOutside={(event) => event.preventDefault()}
          >
            {children}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
