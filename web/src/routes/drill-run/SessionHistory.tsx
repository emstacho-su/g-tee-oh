/**
 * The session's decision history (S46, R3.32, design rule 10, screen review row 50): a "This
 * session" disclosure under the decision area, collapsed by default and counting its decisions,
 * with one row per decision (the hand, the grade with its mark, the loss, Unrated). A row expands
 * in place to that decision's feedback panel, read-only (no Ask), one row at a time, with the
 * sections the page builds for it (slotsFor: range, threshold, roller, insights, explanation), so
 * a reveal that continued by itself is never lost. The owner's note on row 50 is that drill-down
 * "should just expand and collapse", so nothing here is a dialog.
 */
import { useState, type ReactNode } from "react";

import { FeedbackPanel, gradeWithMark, lossText, sectionsFromPanels, SUMMARY_TEXT } from "../../components/trainer/index.js";
import { Disclosure } from "../../components/ui/index.js";
import { handCounterText } from "../../trainer/hand-progress.js";
import type { DecisionEntry } from "../../trainer/session-log.js";
import { unratedReason } from "../../trainer/unrated-reason.js";

export const HISTORY_TEXT = {
  title: "This session",
  empty: "No decisions yet",
  count: (count: number) => `${count} ${count === 1 ? "decision" : "decisions"}`,
} as const;

/** The sections a history row's panel shows; the page builds them for the decision. */
export interface HistorySlots {
  readonly rangeView?: ReactNode;
  readonly thresholdCard?: ReactNode;
  readonly roller?: ReactNode;
  readonly insights?: ReactNode;
  readonly explanation?: ReactNode;
}

export interface SessionHistoryProps {
  entries: readonly DecisionEntry[];
  /** Name the decision within the hand (street and full-hand modes). */
  decisions: boolean;
  slotsFor: (entry: DecisionEntry) => HistorySlots;
}

function rowHint(entry: DecisionEntry): string {
  const parts = [gradeWithMark(entry.feedback.label), lossText(entry.feedback)];
  return (entry.feedback.rated ? parts : [...parts, SUMMARY_TEXT.unrated]).join(" · ");
}

interface HistoryRowProps {
  entry: DecisionEntry;
  decisions: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Builds the row's section bodies, called only while the row is open (PR #50 review). */
  slotsFor: (entry: DecisionEntry) => HistorySlots;
}

function HistoryRow({ entry, decisions, open, onOpenChange, slotsFor }: HistoryRowProps) {
  return (
    <li data-testid="history-row" data-label={entry.feedback.label}>
      <Disclosure
        title={handCounterText(entry.hand, { decision: decisions, ordinal: entry.ordinal })}
        hint={rowHint(entry)}
        headingLevel={4}
        open={open}
        onOpenChange={onOpenChange}
      >
        {/* Mounted only while open, so a closed row keeps no hidden panel and its reads stop. */}
        {open ? (
          <FeedbackPanel
            feedback={entry.feedback}
            actions={entry.prompt.buttons}
            chosenIndex={entry.actionIndex}
            unratedReason={unratedReason(entry.feedback, entry.prompt, entry.session)}
            workedExample={entry.prompt.worked_example}
            defaultOpen={sectionsFromPanels(entry.prompt.visible_panels)}
            {...slotsFor(entry)}
          />
        ) : null}
      </Disclosure>
    </li>
  );
}

export function SessionHistory({ entries, decisions, slotsFor }: SessionHistoryProps) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  return (
    <Disclosure title={HISTORY_TEXT.title} hint={HISTORY_TEXT.count(entries.length)} testId="session-history" className="max-w-md">
      {entries.length === 0 ? (
        <p className="text-sm text-muted">{HISTORY_TEXT.empty}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {entries.map((entry) => (
            <HistoryRow
              key={entry.key}
              entry={entry}
              decisions={decisions}
              open={openKey === entry.key}
              onOpenChange={(open) => setOpenKey(open ? entry.key : null)}
              slotsFor={slotsFor}
            />
          ))}
        </ol>
      )}
    </Disclosure>
  );
}
