/**
 * Your frequencies against the solver's, a /progress card (S41, R4.12, O-347, O-353, O-367, O-417,
 * O-418).
 *
 * Mechanism: the card shows what GET /progress/frequencies answered and computes no poker number
 * (ADR 0004). A select on the shared field class picks one of the most played preflop spots, each
 * named from the response's fields (frequency-model.ts), with the configuration's label once the
 * configuration list is loaded (settings' allConfigsQuery; until then, or if it fails, the id).
 * A spot below the minimum sample shows only "n of 30 decisions at this spot" (the minimum is the
 * response's min_spot_decisions); a spot at or above it shows paired bars per action and the hand
 * rows (FrequencyBars, aria-hidden) and the same numbers in a screen-reader table (FrequencyTable).
 * With no spot the card says how to fill it.
 */
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

import { useAppApi } from "../../auth/index.js";
import { sampleText, spotOptions, type FrequencyComparison } from "../../progress/frequency-model.js";
import { allConfigsQuery } from "../../routes/settings/configs-query.js";
import { Card, FIELD_CLASS, cn } from "../ui/index.js";
import { FrequencyBars } from "./FrequencyBars.js";
import { FrequencyTable } from "./FrequencyTable.js";

export const FREQUENCY_TEXT = {
  title: "Your frequencies against the solver's",
  description: "How often you took each action at a spot you play, next to how often the solver takes it with the same hands.",
  spot: "Spot",
  empty: "Play 30 preflop decisions at one spot to compare your frequencies with the solver's.",
} as const;

export const FREQUENCY_CARD_TEST_ID = "frequency-card";

export interface FrequencyCardProps {
  comparison: FrequencyComparison;
}

export function FrequencyCard({ comparison }: FrequencyCardProps) {
  const api = useAppApi();
  const selectId = useId();
  const configs = useQuery(allConfigsQuery(api));
  const options = spotOptions(comparison.spots, configs.data);
  const [chosen, setChosen] = useState<string | null>(null);
  const spot = comparison.spots.find((entry) => entry.node_key === chosen) ?? comparison.spots[0];
  const label = options.find((option) => option.value === spot?.node_key)?.label ?? "";

  return (
    <Card title={FREQUENCY_TEXT.title} description={FREQUENCY_TEXT.description} testId={FREQUENCY_CARD_TEST_ID}>
      {spot === undefined ? (
        <p className="text-sm text-muted">{FREQUENCY_TEXT.empty}</p>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor={selectId} className="text-sm font-medium">
              {FREQUENCY_TEXT.spot}
            </label>
            <select
              id={selectId}
              value={spot.node_key}
              onChange={(event) => setChosen(event.target.value)}
              className={cn(FIELD_CLASS, "h-10 max-w-full px-2 text-sm sm:max-w-xl")}
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {spot.pooled === null ? (
            <p className="text-sm text-muted">{sampleText(spot.decisions, comparison.min_spot_decisions)}</p>
          ) : (
            <>
              <FrequencyBars spot={spot} pooled={spot.pooled} />
              <FrequencyTable spot={spot} pooled={spot.pooled} caption={label} />
            </>
          )}
        </>
      )}
    </Card>
  );
}
