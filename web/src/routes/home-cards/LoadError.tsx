/**
 * The error state of a home card or a settings section (S32, R4.12, R4.14): an alert naming what
 * could not be loaded and a Try again button. The button's accessible name adds what it retries
 * after the visible words ("Try again: the streak"), so a page with several failed reads offers
 * distinct buttons while the visible label stays "Try again" (label in name).
 */
import { Button, VisuallyHidden } from "../../components/ui/index.js";

export interface LoadErrorProps {
  message: string;
  /** What the button retries, read after "Try again", for example "the streak". */
  retries: string;
  onRetry: () => void;
}

export function LoadError({ message, retries, onRetry }: LoadErrorProps) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 text-sm">
      <p className="text-danger">{message}</p>
      <Button size="sm" onClick={onRetry}>
        Try again<VisuallyHidden>: {retries}</VisuallyHidden>
      </Button>
    </div>
  );
}
