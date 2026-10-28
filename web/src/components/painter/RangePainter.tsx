/**
 * The range painter (S27 lane B, R3.17, O-300, ADR 0020, A7 section 4): paint an action onto every
 * class the node holds, then submit the painted map for grading.
 *
 * Mechanism: the state lives in paint-model.ts (pure, immutable); this component wires the brush
 * picker (BrushPicker.tsx, number keys 1 to 9), the grid (PaintGrid.tsx: click, pointer drag,
 * arrow keys with Space or Enter) and the toolbar (Paint all, Undo, Submit) to it. The paint starts
 * with every held class on the fold brush (or the first action), so Submit always sends every
 * class of the prompt exactly once, keyed by class, with a NodeAction.index for each: the body the
 * api checks before solver-query grades it. Mount it with a key per prompt so a new prompt starts a
 * new paint.
 */
import { useState } from "react";

import type { RangePaintPrompt } from "../../contracts.js";
import { Button } from "../ui/index.js";
import { BrushPicker } from "./BrushPicker.js";
import { PaintGrid } from "./PaintGrid.js";
import {
  beginStroke,
  canUndo,
  endStroke,
  extendStroke,
  initialPaintState,
  paintAll,
  paintOne,
  selectBrush,
  undo,
  type PaintState,
} from "./paint-model.js";

export const PAINTER_TEXT = {
  paintAll: "Paint all",
  undo: "Undo",
  submit: "Submit range",
  hint: "Pick a brush (keys 1 to 9), then click or drag across cells. Arrow keys move, Space or Enter paints.",
} as const;

export interface RangePainterProps {
  prompt: Pick<RangePaintPrompt, "hands" | "actions">;
  submitting: boolean;
  onSubmit: (paint: Record<string, number>) => void;
}

export function RangePainter({ prompt, submitting, onSubmit }: RangePainterProps) {
  const [state, setState] = useState<PaintState>(() => initialPaintState(prompt.hands, prompt.actions));
  const enabled = !submitting;
  const update = (change: (current: PaintState) => PaintState) => setState(change);
  return (
    <div className="flex flex-col gap-3" data-testid="range-painter">
      <BrushPicker actions={prompt.actions} brush={state.brush} enabled={enabled} onBrushChange={(brush) => update((current) => selectBrush(current, brush))} />
      <p className="text-sm text-muted">{PAINTER_TEXT.hint}</p>
      <PaintGrid
        paint={state.paint}
        actions={prompt.actions}
        enabled={enabled}
        onBegin={(hand) => update((current) => beginStroke(current, hand))}
        onExtend={(hand) => update((current) => extendStroke(current, hand))}
        onEnd={() => update(endStroke)}
        onPaintOne={(hand) => update((current) => paintOne(current, hand))}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!enabled} onClick={() => update(paintAll)}>
          {PAINTER_TEXT.paintAll}
        </Button>
        <Button disabled={!enabled || !canUndo(state)} onClick={() => update(undo)}>
          {PAINTER_TEXT.undo}
        </Button>
        <Button variant="primary" disabled={!enabled} onClick={() => onSubmit({ ...state.paint })}>
          {PAINTER_TEXT.submit}
        </Button>
      </div>
    </div>
  );
}
