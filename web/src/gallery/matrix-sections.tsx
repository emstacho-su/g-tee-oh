/**
 * Gallery sections for RangeMatrix (S24, R3.12, O-267): one section per mode (frequency, EV,
 * range weight) over the synthetic study node, plus one with the accessible table fallback open
 * (the shots spec presses its "Show as table" toggle). Selecting a cell only moves the selection
 * here; the study screen that reacts to it is S25.
 */
import { useState } from "react";

import { RangeMatrix } from "../components/range-matrix/RangeMatrix.js";
import type { MatrixMode } from "../components/range-matrix/model.js";
import { fixtureStudyNode } from "../fixtures/index.js";
import type { ThemeName } from "../theme/action-style.js";
import { GallerySection } from "./sections.js";

interface MatrixSectionProps {
  mode: MatrixMode;
  theme: ThemeName;
  name: string;
  title: string;
  note: string;
}

function MatrixSection({ mode, theme, name, title, note }: MatrixSectionProps) {
  const [selected, setSelected] = useState<string | null>("AJo");
  return (
    <GallerySection name={name} title={title} note={note}>
      <RangeMatrix node={fixtureStudyNode} mode={mode} theme={theme} selectedHand={selected} onSelectHand={setSelected} />
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
        note="One bar per action with its pattern and letter, so color is never the only signal (A7 section 4)."
      />
      <MatrixSection
        mode="ev"
        theme={theme}
        name="range-matrix-ev"
        title="RangeMatrix, EV mode"
        note="Best-action EV in bb, printed in each cell."
      />
      <MatrixSection
        mode="weight"
        theme={theme}
        name="range-matrix-weight"
        title="RangeMatrix, range-weight mode"
        note="Fill height and percent from the reach weight."
      />
      <MatrixSection
        mode="frequency"
        theme={theme}
        name="range-matrix-table"
        title="RangeMatrix, accessible table fallback"
        note="The same model rendered as a real table, open through Show as table."
      />
    </>
  );
}
