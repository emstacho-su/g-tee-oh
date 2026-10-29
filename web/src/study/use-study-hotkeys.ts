/**
 * Registers the Study keyboard scope while a confirmed spot is on screen (S45, R3.12, O-466,
 * O-467). Each binding is live only where it can act, so the ? overlay lists only keys that do
 * something here: Left and R past the root, Right while the next likely action opens a preflop
 * node, M on a node with a matrix, Escape while action filters are set, ] and [ while a
 * neighbouring depth covers the pair. S is always live. The handlers are the screen's own
 * navigation (push for a line or depth change, replace for the mode and the filters), so a key does
 * exactly what the matching control does.
 */
import { useHotkey } from "../hotkeys/index.js";
import type { MatrixMode } from "../components/range-matrix/model.js";
import type { Street } from "../contracts.js";
import type { DepthNeighbours } from "./depth-steps.js";
import { LINE_SEPARATOR, lineTokens } from "./line.js";
import { STUDY_MODES } from "./search.js";
import { STUDY_KEYS, STUDY_KEY_TEXT, STUDY_SCOPE, type StudyKeyName } from "./study-hotkeys.js";

export interface StudyHotkeyInputs {
  /** The address's line; undefined or "" is the root. */
  readonly line: string | undefined;
  /** The node's next likely line, or null; undefined while the node has not loaded. */
  readonly nextLikelyLine: string | null | undefined;
  /** The known street of each continuing action's child, by token. */
  readonly childStreets: ReadonlyMap<string, Street>;
  /** The matrix mode shown, or undefined when the node has no matrix (loading, failed, postflop). */
  readonly mode: MatrixMode | undefined;
  readonly filterCount: number;
  readonly depths: DepthNeighbours;
  readonly onOpenLine: (line: string) => void;
  readonly onModeChange: (mode: MatrixMode) => void;
  readonly onClearFilters: () => void;
  readonly onDepthChange: (depth: number) => void;
  readonly onOpenSettings: () => void;
}

/** The mode after this one in the Study mode list, wrapping round. */
export function nextMode(mode: MatrixMode): MatrixMode {
  const position = STUDY_MODES.indexOf(mode);
  return STUDY_MODES[(position + 1) % STUDY_MODES.length] ?? mode;
}

/** The next likely line when it opens a preflop node (or one whose street is not known yet), else null. */
export function followableLine(nextLikelyLine: string | null | undefined, childStreets: ReadonlyMap<string, Street>): string | null {
  if (nextLikelyLine === null || nextLikelyLine === undefined) return null;
  const token = lineTokens(nextLikelyLine).at(-1);
  const street = token === undefined ? undefined : childStreets.get(token);
  return street === undefined || street === "preflop" ? nextLikelyLine : null;
}

function useStudyKey(name: StudyKeyName, handler: () => void, enabled: boolean): void {
  useHotkey({ key: STUDY_KEYS[name], description: STUDY_KEY_TEXT[name], scope: STUDY_SCOPE, handler }, enabled);
}

export function useStudyHotkeys(inputs: StudyHotkeyInputs): void {
  const tokens = lineTokens(inputs.line);
  const pastRoot = tokens.length > 0;
  const next = followableLine(inputs.nextLikelyLine, inputs.childStreets);
  const { deeper, shallower } = inputs.depths;
  const mode = inputs.mode;

  useStudyKey("back", () => inputs.onOpenLine(tokens.slice(0, -1).join(LINE_SEPARATOR)), pastRoot);
  useStudyKey("next", () => next !== null && inputs.onOpenLine(next), next !== null);
  useStudyKey("root", () => inputs.onOpenLine(""), pastRoot);
  useStudyKey("deeper", () => deeper !== undefined && inputs.onDepthChange(deeper), deeper !== undefined);
  useStudyKey("shallower", () => shallower !== undefined && inputs.onDepthChange(shallower), shallower !== undefined);
  useStudyKey("mode", () => mode !== undefined && inputs.onModeChange(nextMode(mode)), mode !== undefined);
  useStudyKey("settings", inputs.onOpenSettings, true);
  useStudyKey("clearFilters", inputs.onClearFilters, inputs.filterCount > 0);
}
