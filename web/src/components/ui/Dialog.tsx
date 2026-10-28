/**
 * A modal dialog over Radix Dialog (S24, O-44). Radix handles the focus trap, Escape to close,
 * scroll locking and the aria wiring (role dialog, aria-labelledby on the title); this wrapper
 * only adds the app's styling (the raised surface and the tactile close button, S36) and
 * requires a title so every dialog has an accessible name.
 */
import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}

export function Dialog({ open, onOpenChange, title, description, children }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 bg-[rgb(28_18_16/0.55)] backdrop-blur-[2px]" />
        <RadixDialog.Content
          className="fixed top-1/2 left-1/2 max-h-[85vh] w-[90vw] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border border-border/50 bg-surface-raised p-6 text-text raised"
          {...(description === undefined ? { "aria-describedby": undefined } : {})}
        >
          <RadixDialog.Title className="text-lg font-semibold">{title}</RadixDialog.Title>
          {description === undefined ? null : (
            <RadixDialog.Description className="mt-1 text-sm text-muted">{description}</RadixDialog.Description>
          )}
          <div className="mt-4">{children}</div>
          <RadixDialog.Close className="tactile absolute top-3 right-3 rounded-lg px-2 text-muted [--tactile-rest:none] hover:bg-surface-sunken hover:text-text" aria-label="Close">
            {"×"}
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
