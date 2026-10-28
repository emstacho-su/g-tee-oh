/**
 * The live password strength meter (S42, R3.13, O-424): four segments and a word, updated as the
 * password changes. The estimator loads on mount (its own chunk); until then the reading is by
 * length alone. The word sits in a polite live region, so a screen reader hears the change without
 * being interrupted on every key. Colour is never the only signal: the word always says it.
 */
import { useEffect, useState } from "react";

import { cn } from "../../components/ui/index.js";
import { PASSWORD_TEXT } from "./onboarding-text.js";
import { loadStrengthEstimator, strengthOf, type StrengthEstimator, type StrengthScore } from "./strength.js";

const SEGMENTS = [1, 2, 3, 4] as const;
const FILL_CLASS: Readonly<Record<StrengthScore, string>> = {
  0: "bg-danger",
  1: "bg-danger",
  2: "bg-warning",
  3: "bg-success",
  4: "bg-success",
};

export interface StrengthMeterProps {
  id: string;
  password: string;
  userInputs: readonly string[];
}

/** The estimator once it has loaded; null before, and after a failed load (length only). */
export function useStrengthEstimator(): StrengthEstimator | null {
  const [estimator, setEstimator] = useState<StrengthEstimator | null>(null);
  useEffect(() => {
    let active = true;
    loadStrengthEstimator().then(
      (loaded) => {
        if (active) setEstimator(() => loaded);
      },
      (error: unknown) => {
        console.error(`g-tee-oh: the password strength estimator did not load (${error instanceof Error ? error.name : "unknown"})`);
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return estimator;
}

export function StrengthMeter({ id, password, userInputs }: StrengthMeterProps) {
  const estimator = useStrengthEstimator();
  const estimate = estimator === null || password === "" ? null : estimator(password, userInputs);
  const { score, label } = strengthOf(password, estimate);
  return (
    <div className="flex items-center gap-3" data-testid="strength-meter" data-score={score}>
      <div className="flex flex-1 gap-1" aria-hidden="true">
        {SEGMENTS.map((segment) => (
          <span
            key={segment}
            className={cn("h-1.5 flex-1 rounded-full", segment <= score && password !== "" ? FILL_CLASS[score] : "bg-surface-sunken")}
          />
        ))}
      </div>
      <p id={id} aria-live="polite" className="min-w-16 text-right text-xs text-muted">
        <span className="sr-only">{PASSWORD_TEXT.strengthLabel}: </span>
        {password === "" ? "" : label}
      </p>
    </div>
  );
}
