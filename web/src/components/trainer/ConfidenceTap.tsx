/**
 * The confidence tap (S24, 05, R3.13): before any reveal the hero says whether they are sure or
 * unsure, which feeds calibration and the confident-miss rule in packages/learning. Two buttons,
 * "Sure" and "Unsure", with hotkeys S and U registered through useHotkey while enabled.
 */
import { useId } from "react";

import { Button } from "../ui/index.js";
import { useHotkey } from "../../hotkeys/index.js";

export type ConfidenceChoice = "sure" | "unsure";

export const CONFIDENCE_SCOPE = "Confidence";
const SURE_KEY = "S";
const UNSURE_KEY = "U";

export interface ConfidenceTapProps {
  onChoose: (choice: ConfidenceChoice) => void;
  disabled?: boolean;
}

export function ConfidenceTap({ onChoose, disabled = false }: ConfidenceTapProps) {
  const instructionId = useId();
  const chooseSure = () => onChoose("sure");
  const chooseUnsure = () => onChoose("unsure");
  useHotkey({ key: SURE_KEY, description: "Sure", scope: CONFIDENCE_SCOPE, handler: chooseSure }, !disabled);
  useHotkey({ key: UNSURE_KEY, description: "Unsure", scope: CONFIDENCE_SCOPE, handler: chooseUnsure }, !disabled);
  return (
    <div data-testid="confidence-tap" role="group" aria-labelledby={instructionId} className="flex flex-col gap-2">
      <p id={instructionId} className="text-sm text-muted">
        How sure are you? Answer before the reveal.
      </p>
      <div className="flex gap-2">
        <Button aria-label="Sure" aria-keyshortcuts={SURE_KEY} disabled={disabled} onClick={chooseSure}>
          <kbd aria-hidden="true" className="font-mono text-xs">
            {SURE_KEY}
          </kbd>
          <span aria-hidden="true">Sure</span>
        </Button>
        <Button aria-label="Unsure" aria-keyshortcuts={UNSURE_KEY} disabled={disabled} onClick={chooseUnsure}>
          <kbd aria-hidden="true" className="font-mono text-xs">
            {UNSURE_KEY}
          </kbd>
          <span aria-hidden="true">Unsure</span>
        </Button>
      </div>
    </div>
  );
}
