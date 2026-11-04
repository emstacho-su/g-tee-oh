/**
 * The quiz start screen (S41, R3.16, O-350, O-410, O-411, O-415, O-416): one card with the table
 * (a select over the served configurations), the positions (any number of the seats at that table;
 * a seat with no covered pair is disabled and named in a note), the spot types, the question kinds
 * and the difficulty, with one line on what each difficulty asks. Start quiz waits for a table, a
 * position, a spot type and a question kind, then hands the choice to the page, which writes it to
 * the address. The initial choice comes from the address or the last quiz; seats a new table does
 * not cover drop out of the choice.
 */
import { useState } from "react";

import { ChoiceField } from "../../components/practice/ChoiceField.js";
import { TableSelect } from "../../components/practice/TableSelect.js";
import { Button, Card, LoadingNote, MultiToggleGroup, ToggleGroup } from "../../components/ui/index.js";
import type { Position } from "../../contracts.js";
import { SPOT_TYPE_OPTIONS, type SpotType } from "../../practice/catalog-spot.js";
import type { QuizChoice, QuizDifficulty, QuizKind } from "../../practice/quiz-search.js";
import { useCatalogTable } from "../../practice/use-catalog-table.js";
import { problemText } from "../../prediction/labels.js";
import { DIFFICULTY_OPTIONS, KIND_OPTIONS, QUIZ_START_TEXT, uncoveredNote } from "../../prediction/quiz-text.js";

export interface QuizStartProps {
  initial: Partial<QuizChoice>;
  onStart: (choice: QuizChoice) => void;
}

const DEFAULT_DIFFICULTY: QuizDifficulty = "easy";

export function QuizStart({ initial, onStart }: QuizStartProps) {
  const table = useCatalogTable(initial.config);
  const [positions, setPositions] = useState<readonly Position[]>(initial.positions ?? []);
  const [spots, setSpots] = useState<readonly SpotType[]>(initial.spots ?? []);
  const [kinds, setKinds] = useState<readonly QuizKind[]>(initial.kinds ?? []);
  const [difficulty, setDifficulty] = useState<QuizDifficulty>(initial.difficulty ?? DEFAULT_DIFFICULTY);
  const covered = new Set(table.covered);
  const chosenSeats = positions.filter((seat) => covered.has(seat));
  const uncovered = table.pairs === undefined ? [] : table.seated.filter((seat) => !covered.has(seat));
  const ready = table.configId !== null && chosenSeats.length > 0 && spots.length > 0 && kinds.length > 0;
  const failure = table.configsError ?? table.pairsError;
  const note = uncoveredNote(uncovered);

  if (table.configs === undefined) {
    return failure === null ? <LoadingNote text={QUIZ_START_TEXT.loadingTables} /> : <p role="alert" className="text-danger">{problemText(failure)}</p>;
  }
  return (
    <Card title={QUIZ_START_TEXT.cardTitle} className="max-w-3xl">
      {table.configs.length === 0 ? <p>{QUIZ_START_TEXT.noTables}</p> : null}
      <TableSelect label={QUIZ_START_TEXT.table} configs={table.configs} value={table.configId} onChange={table.setConfigId} />
      <ChoiceField label={QUIZ_START_TEXT.positions} note={note}>
        <MultiToggleGroup
          label={QUIZ_START_TEXT.positions}
          value={chosenSeats}
          options={table.seated.map((seat) => ({ value: seat, label: seat, disabled: !covered.has(seat) }))}
          onValueChange={setPositions}
        />
        {table.pairs === undefined && table.pairsError === null ? <LoadingNote text={QUIZ_START_TEXT.loadingSeats} /> : null}
      </ChoiceField>
      {table.pairsError === null ? null : (
        <p role="alert" className="text-danger">
          {problemText(table.pairsError)}
        </p>
      )}
      <ChoiceField label={QUIZ_START_TEXT.spotTypes}>
        <MultiToggleGroup label={QUIZ_START_TEXT.spotTypes} value={spots} options={SPOT_TYPE_OPTIONS} onValueChange={setSpots} />
      </ChoiceField>
      <ChoiceField label={QUIZ_START_TEXT.kinds}>
        <MultiToggleGroup label={QUIZ_START_TEXT.kinds} value={kinds} options={KIND_OPTIONS} onValueChange={setKinds} />
      </ChoiceField>
      <ChoiceField label={QUIZ_START_TEXT.difficulty}>
        <ToggleGroup wrap label={QUIZ_START_TEXT.difficulty} value={difficulty} options={DIFFICULTY_OPTIONS} onValueChange={setDifficulty} />
        <ul aria-label={QUIZ_START_TEXT.difficulty} className="flex flex-col gap-0.5 text-xs text-muted">
          {QUIZ_START_TEXT.levels.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </ChoiceField>
      <div>
        <Button
          variant="primary"
          size="lg"
          disabled={!ready}
          onClick={() => {
            if (ready && table.configId !== null) onStart({ config: table.configId, positions: chosenSeats, spots, kinds, difficulty });
          }}
        >
          {QUIZ_START_TEXT.start}
        </Button>
      </div>
    </Card>
  );
}
