/**
 * A modal dialog over Radix Dialog (S24, O-44). Radix handles the focus trap, Escape to close,
 * scroll locking and the aria wiring (role dialog, aria-labelledby on the title); this wrapper
 * only adds the app's styling and requires a title so every dialog has an accessible name.
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
        <RadixDialog.Overlay className="fixed inset-0 bg-black/50" />
        <RadixDialog.Content
          className="fixed top-1/2 left-1/2 max-h-[85vh] w-[90vw] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg border border-border bg-surface-raised p-6 text-text shadow-xl"
          {...(description === undefined ? { "aria-describedby": undefined } : {})}
        >
          <RadixDialog.Title className="text-lg font-semibold">{title}</RadixDialog.Title>
          {description === undefined ? null : (
            <RadixDialog.Description className="mt-1 text-sm text-muted">{description}</RadixDialog.Description>
          )}
          <div className="mt-4">{children}</div>
          <RadixDialog.Close className="absolute top-3 right-3 rounded px-2 text-muted hover:text-text" aria-label="Close">
            {"×"}
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
