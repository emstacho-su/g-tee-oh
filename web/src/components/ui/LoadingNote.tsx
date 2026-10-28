/**
 * A loading note (S25): one status line, announced politely by screen readers through the status
 * role, used by the study screen, the feedback panel and the trainer alike.
 */
export interface LoadingNoteProps {
  text: string;
}

export function LoadingNote({ text }: LoadingNoteProps) {
  return (
    <p role="status" className="text-sm text-muted">
      {text}
    </p>
  );
}
