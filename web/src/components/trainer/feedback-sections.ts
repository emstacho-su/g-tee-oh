/**
 * The feedback panel's sections and their open state (S38, R3.13, O-387, O-388).
 *
 * Mechanism: each section has a key, a title and a default. Everything starts collapsed except
 * Roll (open whenever the roller is given, since the roll scale and its followed-the-roll mark are
 * the point of Mixed-frequency mode, O-344, O-371) and Strategy on a worked-example prompt (the
 * block exists to show the answer, O-272). What the user opens or closes wins over the default
 * and lasts for the rest of the session: useFeedbackSections keeps the choices in React state
 * (memory only, never stored) keyed by the session, so a new session starts from the defaults
 * again. A screen holds the control above the panel, because the panel itself unmounts between
 * decisions; without one the panel keeps its own choices for its own lifetime.
 */
import { useCallback, useMemo, useState } from "react";

import { EXPLAIN_TEXT } from "../../explain/texts.js";

export type FeedbackSectionKey = "strategy" | "roll" | "range" | "threshold" | "insights" | "explanation";

/** Open (true) or closed (false) per section; an absent key falls back to the default. */
export type FeedbackOpenState = Readonly<Partial<Record<FeedbackSectionKey, boolean>>>;

export interface FeedbackSectionsControl {
  readonly open: FeedbackOpenState;
  readonly setOpen: (section: FeedbackSectionKey, open: boolean) => void;
}

export const FEEDBACK_SECTION_TITLES: Readonly<Record<FeedbackSectionKey, string>> = {
  strategy: "Strategy",
  roll: "Roll",
  range: "Range",
  threshold: "Where your hand sits",
  insights: "Insights",
  explanation: EXPLAIN_TEXT.explanation,
};

/** The order the sections appear in, under the summary. */
export const FEEDBACK_SECTION_ORDER: readonly FeedbackSectionKey[] = ["roll", "strategy", "range", "threshold", "insights", "explanation"];

export interface SectionDefaultsInput {
  readonly workedExample: boolean;
}

/** The default open state of one section before the user chooses (O-387). */
export function defaultSectionOpen(section: FeedbackSectionKey, { workedExample }: SectionDefaultsInput): boolean {
  if (section === "roll") return true;
  if (section === "strategy") return workedExample;
  return false;
}

/** Whether a section is open: the user's choice, else the caller's default, else the built-in one. */
export function resolveSectionOpen(
  section: FeedbackSectionKey,
  chosen: FeedbackOpenState,
  callerDefaults: FeedbackOpenState | undefined,
  input: SectionDefaultsInput,
): boolean {
  return chosen[section] ?? callerDefaults?.[section] ?? defaultSectionOpen(section, input);
}

const NO_CHOICES: FeedbackOpenState = Object.freeze({});

interface KeyedChoices {
  readonly key: string | null;
  readonly open: FeedbackOpenState;
}

/**
 * The session's remembered section choices. resetKey is the session id: when it changes, the
 * choices go back to empty, so each session starts from the defaults.
 */
export function useFeedbackSections(resetKey: string | null): FeedbackSectionsControl {
  const [state, setState] = useState<KeyedChoices>({ key: resetKey, open: NO_CHOICES });
  const stale = state.key !== resetKey;
  if (stale) setState({ key: resetKey, open: NO_CHOICES });
  const open = stale ? NO_CHOICES : state.open;
  const setOpen = useCallback((section: FeedbackSectionKey, next: boolean) => {
    setState((previous) => ({ key: previous.key, open: { ...previous.open, [section]: next } }));
  }, []);
  return useMemo(() => ({ open, setOpen }), [open, setOpen]);
}
