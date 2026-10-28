/**
 * The builder's board filter section (S26, R3.14, O-317): high card, paired, suits,
 * connectivity and an explicit flop list (spot_filter.board). v1 serves preflop spots, so the
 * section always carries the v1 note; the values stay editable and are stored with the drill, so
 * a drill written for later versions round-trips. "Any" leaves a filter unset.
 */
import type { BoardDraft, PairedChoice } from "../../drills/draft.js";
import { CONNECTIVITY_LABELS, SUITS_LABELS, V1_NOTES } from "../../drills/labels.js";
import type { BoardConnectivity, BoardSuits, HighCard } from "../../drills/types.js";
import { RANKS } from "../../poker/cards.js";
import { FormSection, SelectField, TextField, V1Note, type Choice } from "./form-parts.js";
import type { SectionProps } from "./GameSection.js";

const ANY: Choice<""> = { value: "", label: "Any" };
const HIGH_CARD_CHOICES: readonly Choice<HighCard | "">[] = [ANY, ...RANKS.map((rank) => ({ value: rank, label: rank }))];
const PAIRED_CHOICES: readonly Choice<PairedChoice>[] = [ANY, { value: "yes", label: "Paired" }, { value: "no", label: "Unpaired" }];
const SUITS_CHOICES: readonly Choice<BoardSuits | "">[] = [
  ANY,
  ...(Object.keys(SUITS_LABELS) as BoardSuits[]).map((suits) => ({ value: suits, label: SUITS_LABELS[suits] })),
];
const CONNECTIVITY_CHOICES: readonly Choice<BoardConnectivity | "">[] = [
  ANY,
  ...(Object.keys(CONNECTIVITY_LABELS) as BoardConnectivity[]).map((value) => ({ value, label: CONNECTIVITY_LABELS[value] })),
];

export function BoardSection({ draft, onChange, errors }: SectionProps) {
  const setBoard = (change: Partial<BoardDraft>) => onChange({ ...draft, board: { ...draft.board, ...change } });
  return (
    <FormSection title="Board">
      <V1Note text={V1_NOTES.board} />
      <div className="flex flex-wrap gap-6">
        <SelectField label="High card" value={draft.board.highCard} options={HIGH_CARD_CHOICES} onChange={(highCard) => setBoard({ highCard })} />
        <SelectField label="Paired board" value={draft.board.paired} options={PAIRED_CHOICES} onChange={(paired) => setBoard({ paired })} />
        <SelectField label="Suits" value={draft.board.suits} options={SUITS_CHOICES} onChange={(suits) => setBoard({ suits })} />
        <SelectField
          label="Connectivity"
          value={draft.board.connectivity}
          options={CONNECTIVITY_CHOICES}
          onChange={(connectivity) => setBoard({ connectivity })}
        />
      </div>
      <TextField
        label="Flops (optional)"
        hint="Three cards each, separated by spaces, for example Kh8d3c Qs9s2h."
        value={draft.board.flopsText}
        onChange={(flopsText) => setBoard({ flopsText })}
        errors={[...(errors["spot_filter.board"] ?? []), ...(errors["spot_filter.board.flops"] ?? [])]}
      />
    </FormSection>
  );
}
