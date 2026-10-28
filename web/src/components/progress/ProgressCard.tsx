/**
 * The frame every progress card shares (S32, R4.12): a labelled section with a heading, an
 * optional line of actions beside it and the body. The /progress screen and the home cards use it,
 * so the two screens read as one system. Since S36 it is the components/ui Card (O-346), so the
 * raised surface is defined in one place.
 */
import type { ReactNode } from "react";

import { Card } from "../ui/index.js";

export interface ProgressCardProps {
  title: string;
  /** Controls beside the heading (a weeks selector). */
  actions?: ReactNode;
  className?: string;
  testId?: string;
  children: ReactNode;
}

export function ProgressCard({ title, actions, className, testId, children }: ProgressCardProps) {
  return (
    <Card
      title={title}
      {...(actions === undefined ? {} : { actions })}
      {...(className === undefined ? {} : { className })}
      {...(testId === undefined ? {} : { testId })}
    >
      {children}
    </Card>
  );
}
