/**
 * A modal dialog over Radix Dialog (S24, O-44). Radix handles the focus trap, Escape to close,
 * scroll locking and the aria wiring (role dialog, aria-labelledby on the title); this wrapper
 * only adds the app's styling and requires a title so every dialog has an accessible name.
 *
 * S36: the content is the raised surface and the close button takes the flat tactile press, from
 * the shared class constants; the overlay is the --overlay token of each theme. Overlay and content
 * sit on the overlay and dialog layers (layers.ts), above the sticky header, so the header never
 * covers a dialog's title or its Close button.
 */
import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

import { cn } from "./cn.js";
import { DIALOG_LAYER_CLASS, OVERLAY_LAYER_CLASS } from "./layers.js";
import { FLAT_REST_CLASS, RAISED_CLASS, TACTILE_CLASS } from "./tactile.js";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}

const OVERLAY_CLASSES = cn("fixed inset-0 bg-overlay backdrop-blur-[2px]", OVERLAY_LAYER_CLASS);
const CONTENT_CLASSES = cn(
  "fixed top-1/2 left-1/2 max-h-[85vh] w-[90vw] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border border-border/50 bg-surface-raised p-6 text-text",
  RAISED_CLASS,
  DIALOG_LAYER_CLASS,
);
const CLOSE_CLASSES = cn("absolute top-3 right-3 rounded-lg px-2 text-muted hover:bg-surface-sunken hover:text-text", TACTILE_CLASS, FLAT_REST_CLASS);

export function Dialog({ open, onOpenChange, title, description, children }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay data-testid="dialog-overlay" className={OVERLAY_CLASSES} />
        <RadixDialog.Content className={CONTENT_CLASSES} {...(description === undefined ? { "aria-describedby": undefined } : {})}>
          <RadixDialog.Title className="text-lg font-semibold">{title}</RadixDialog.Title>
          {description === undefined ? null : (
            <RadixDialog.Description className="mt-1 text-sm text-muted">{description}</RadixDialog.Description>
          )}
          <div className="mt-4">{children}</div>
          <RadixDialog.Close className={CLOSE_CLASSES} aria-label="Close">
            {"×"}
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
