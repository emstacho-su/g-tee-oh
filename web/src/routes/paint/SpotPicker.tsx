/**
 * The /paint spot picker (S41, R3.17, O-351, O-415, O-416): what to paint, by table, seat and spot
 * instead of by drill. The table is a select over the served configurations; Position offers only
 * the seats the library covers at that table (a seat in an available pair); Spot offers the five
 * spot types; Opponent is optional ("Any" by default, the seats that share an available pair with
 * the hero) and reads "Opener" when the spot is Facing an open. Start painting hands the choice to
 * the page, which writes it to the address. The goal line the page shows under its heading lives
 * here with the picker's other words.
 */
import { useState } from "react";

import { ChoiceField } from "../../components/practice/ChoiceField.js";
import { TableSelect } from "../../components/practice/TableSelect.js";
import { Button, Card, LoadingNote, ToggleGroup } from "../../components/ui/index.js";
import type { Position } from "../../contracts.js";
import { SPOT_TYPE_OPTIONS, opponentSeats, type SpotType } from "../../practice/catalog-spot.js";
import type { PaintChoice } from "../../practice/paint-search.js";
import { useCatalogTable } from "../../practice/use-catalog-table.js";

export const PICKER_TEXT = {
  title: "Choose a spot to paint",
  goal: "Paint the action you take with every hand from this seat. The grade is the expected value (EV) your whole range gives up, each hand weighted by how often it reaches this spot.",
  table: "Table",
  position: "Position",
  spot: "Spot",
  opponent: "Opponent",
  opener: "Opener",
  any: "Any",
  start: "Start painting",
  loadingTables: "Loading the tables.",
  loadingSeats: "Loading the seats.",
  tablesFailed: "The tables could not be loaded. Reload the page to try again.",
  seatsFailed: "The seats of this table could not be loaded. Reload the page to try again.",
  noSeat: "No seat at this table has a solved spot yet.",
} as const;

const ANY = "any";
const DEFAULT_SPOT: SpotType = "rfi";
type OpponentValue = Position | typeof ANY;

export interface SpotPickerProps {
  initial: Partial<PaintChoice>;
  onStart: (choice: PaintChoice) => void;
}

function Alert({ text }: { text: string }) {
  return (
    <p role="alert" className="text-danger">
      {text}
    </p>
  );
}

export function SpotPicker({ initial, onStart }: SpotPickerProps) {
  const table = useCatalogTable(initial.config);
  const [wantedSeat, setSeat] = useState<Position | null>(initial.position ?? null);
  const [spot, setSpot] = useState<SpotType>(initial.spot ?? DEFAULT_SPOT);
  const [wantedOpponent, setOpponent] = useState<OpponentValue>(initial.vs ?? ANY);
  const position = wantedSeat !== null && table.covered.includes(wantedSeat) ? wantedSeat : (table.covered[0] ?? null);
  const opponents = position === null || table.pairs === undefined ? [] : opponentSeats(table.pairs, position, table.seated);
  const opponent = wantedOpponent !== ANY && opponents.includes(wantedOpponent) ? wantedOpponent : ANY;
  const opponentLabel = spot === "vs_open" ? PICKER_TEXT.opener : PICKER_TEXT.opponent;

  if (table.configs === undefined) {
    return table.configsError === null ? <LoadingNote text={PICKER_TEXT.loadingTables} /> : <Alert text={PICKER_TEXT.tablesFailed} />;
  }
  const config = table.configId;
  return (
    <Card title={PICKER_TEXT.title} testId="paint-picker" className="max-w-3xl">
      <TableSelect label={PICKER_TEXT.table} configs={table.configs} value={config} onChange={table.setConfigId} />
      {table.pairsError === null ? null : <Alert text={PICKER_TEXT.seatsFailed} />}
      {table.pairs === undefined && table.pairsError === null ? <LoadingNote text={PICKER_TEXT.loadingSeats} /> : null}
      {table.pairs !== undefined && position === null ? <p className="text-sm">{PICKER_TEXT.noSeat}</p> : null}
      {position === null ? null : (
        <ChoiceField label={PICKER_TEXT.position}>
          <ToggleGroup wrap label={PICKER_TEXT.position} value={position} options={table.covered.map((seat) => ({ value: seat, label: seat }))} onValueChange={setSeat} />
        </ChoiceField>
      )}
      <ChoiceField label={PICKER_TEXT.spot}>
        <ToggleGroup wrap label={PICKER_TEXT.spot} value={spot} options={SPOT_TYPE_OPTIONS} onValueChange={setSpot} />
      </ChoiceField>
      {position === null ? null : (
        <ChoiceField label={opponentLabel}>
          <ToggleGroup<OpponentValue>
            wrap
            label={opponentLabel}
            value={opponent}
            options={[{ value: ANY, label: PICKER_TEXT.any }, ...opponents.map((seat) => ({ value: seat, label: seat }))]}
            onValueChange={setOpponent}
          />
        </ChoiceField>
      )}
      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          size="lg"
          disabled={config === null || position === null}
          onClick={() => {
            if (config !== null && position !== null) onStart({ config, position, spot, vs: opponent === ANY ? null : opponent });
          }}
        >
          {PICKER_TEXT.start}
        </Button>
      </div>
    </Card>
  );
}
