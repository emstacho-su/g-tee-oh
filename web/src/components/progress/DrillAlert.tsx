/**
 * The inline note a progress card shows when a click to drill did not open one (S32, R4.12,
 * O-321): no covered configuration matches the spot, or a request failed. role="alert", so it is
 * announced when it appears; the text is the caller's plain words, never a server detail.
 */
export interface DrillAlertProps {
  text: string | null | undefined;
}

export function DrillAlert({ text }: DrillAlertProps) {
  if (text === null || text === undefined) return null;
  return (
    <p role="alert" className="rounded-md border border-warning px-3 py-2 text-sm text-text" data-testid="drill-alert">
      {text}
    </p>
  );
}
