/**
 * Gallery sections for RangeMatrix (S24, S38, R3.12, O-267, O-384 to O-386): one section per mode
 * (frequency, EV, range weight) over the synthetic study node, each with its legend, plus one with
 * a cell's pop-out open (initialPopOutHand), so a screenshot shows the enlarged cell and its exact
 * numbers. The accessible table is screen-reader only (O-347), so it has no section of its own.
 * Selecting a cell only moves the selection here; the study screen that reacts to it is S25.
 */
import { useState } from "react";

import { RangeMatrix } from "../components/range-matrix/RangeMatrix.js";
import type { MatrixMode } from "../components/range-matrix/model.js";
import { fixtureStudyNode } from "../fixtures/index.js";
import type { ThemeName } from "../theme/action-style.js";
import { GallerySection } from "./sections.js";

/** The hand the pop-out section opens: a mixed hand, so every line has a number. */
const POP_OUT_HAND = "KQs";

interface MatrixSectionProps {
  mode: MatrixMode;
  theme: ThemeName;
  name: string;
  title: string;
  note: string;
  popOutHand?: string;
  scaleByWeight?: boolean;
}

function MatrixSection({ mode, theme, name, title, note, popOutHand, scaleByWeight = false }: MatrixSectionProps) {
  const [selected, setSelected] = useState<string | null>(popOutHand ?? "AJo");
  return (
    <GallerySection name={name} title={title} note={note}>
      <RangeMatrix
        node={fixtureStudyNode}
        mode={mode}
        theme={theme}
        selectedHand={selected}
        onSelectHand={setSelected}
        scaleByWeight={scaleByWeight}
        {...(popOutHand === undefined ? {} : { initialPopOutHand: popOutHand })}
      />
    </GallerySection>
  );
}

export interface MatrixSectionsProps {
  theme: ThemeName;
}

export function MatrixSections({ theme }: MatrixSectionsProps) {
  return (
    <>
      <MatrixSection
        mode="frequency"
        theme={theme}
        name="range-matrix-frequency"
        title="RangeMatrix, frequency mode"
        note="One bar per action with its pattern, and a legend of swatches and names, so color is never the only signal (A7 section 4)."
      />
      <MatrixSection
        mode="ev"
        theme={theme}
        name="range-matrix-ev"
        title="RangeMatrix, EV mode"
        note="Best-action EV in bb on a diverging scale: brick red loses, blue wins, near 0 is neutral (O-384)."
      />
      <MatrixSection
        mode="weight"
        theme={theme}
        name="range-matrix-weight"
        title="RangeMatrix, range-weight mode"
        note="The progress heat ramp fills each cell by its share of the range (O-385)."
      />
      <MatrixSection
        mode="strategy_ev"
        theme={theme}
        name="range-matrix-strategy-ev"
        title="RangeMatrix, strategy with EV"
        note="Frequency bars scaled to each hand's range weight, with the best action's EV printed in the corner (R3.24, O-465)."
        scaleByWeight
      />
      <MatrixSection
        mode="compare"
        theme={theme}
        name="range-matrix-compare"
        title="RangeMatrix, compare to best"
        note="Each cell coloured by the chosen action's served loss against the best action, in percent of the pot on the EV scale's red side (R3.24, O-462, O-464)."
      />
      <MatrixSection
        mode="frequency"
        theme={theme}
        name="range-matrix-popout"
        title="RangeMatrix, a cell popped out"
        note="A click or Enter enlarges the cell with each action's exact frequency and EV; the next click closes it (O-386)."
        popOutHand={POP_OUT_HAND}
      />
    </>
  );
}
