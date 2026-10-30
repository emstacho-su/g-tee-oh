/**
 * The answered question folds to one line (S47 critic G3, R3.16): once a result is set, the
 * question card (badges, spot, choices, reason) collapses behind a one-line summary, so on a phone
 * the verdict and Next sit near the top instead of a screen below. The summary is a disclosure, so
 * the answered card stays one click away; before the answer the card renders as it always did.
 */
import type { ReactNode } from "react";

import { Disclosure } from "../../components/ui/index.js";

export const ANSWERED_TEXT = {
  summary: "Your answer",
} as const;

export interface AnsweredFoldProps {
  answered: boolean;
  question: string;
  children: ReactNode;
}

export function AnsweredFold({ answered, question, children }: AnsweredFoldProps) {
  if (!answered) return <>{children}</>;
  return (
    <Disclosure title={ANSWERED_TEXT.summary} hint={question} headingLevel={2} lazy={false} testId="answered-fold">
      {children}
    </Disclosure>
  );
}
