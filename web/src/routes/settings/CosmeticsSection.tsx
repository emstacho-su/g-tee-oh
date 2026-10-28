/**
 * The Cosmetics section of /settings (S32, R4.14, O-323, O-279, ADR 0012): three slots, card back,
 * table felt and badge. Each lists "None" (the standard look) and the catalog items of its kind;
 * the items the server has unlocked (GET /progress/streak) are selectable radio buttons, the rest
 * are disabled and say "Locked" with a lock glyph and the rule that unlocks them. Every option has
 * a small preview: a face-down card for card backs, a felt swatch for felts, the pill for badges.
 *
 * Mechanism: the choice is written to the cosmetics store at once; CosmeticsRoot applies it across
 * the app. The previews set data-card-back or data-felt on their own wrapper, so styles.css paints
 * each one with its item whatever is equipped. Cosmetics change how the app looks and nothing else.
 */
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";

import { useAppApi } from "../../auth/index.js";
import { BadgePill } from "../../cosmetics/BadgePill.js";
import { cosmeticsOfKind, type CosmeticEntry, type CosmeticKind } from "../../cosmetics/catalog.js";
import { CardView } from "../../components/table/index.js";
import { LoadingNote, cn } from "../../components/ui/index.js";
import { streakQuery } from "../../progress/queries.js";
import { COSMETIC_SLOTS, useCosmeticsStore } from "../../store/index.js";
import { LoadError } from "../home-cards/LoadError.js";
import { COSMETIC_SLOT_TITLES, COSMETICS_TEXT } from "./settings-text.js";
import { SettingsSection } from "./SettingsSection.js";

const STANDARD_LOOK = "none";

function LockGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
      <path d="M4 7V5a4 4 0 1 1 8 0v2h1v8H3V7h1Zm2 0h4V5a2 2 0 1 0-4 0v2Z" />
    </svg>
  );
}

function Preview({ kind, cosmeticKey }: { kind: CosmeticKind; cosmeticKey: string | null }) {
  if (kind === "card-back") {
    return (
      <span aria-hidden="true" data-card-back={cosmeticKey ?? STANDARD_LOOK} className="inline-flex">
        <CardView faceDown size="sm" />
      </span>
    );
  }
  if (kind === "felt") {
    return (
      <span aria-hidden="true" data-felt={cosmeticKey ?? STANDARD_LOOK} className="inline-flex">
        <span className="block h-7 w-12 rounded-[50%] border-4 border-felt-edge bg-felt" />
      </span>
    );
  }
  return cosmeticKey === null ? null : (
    <span aria-hidden="true">
      <BadgePill cosmeticKey={cosmeticKey} />
    </span>
  );
}

interface OptionProps {
  kind: CosmeticKind;
  name: string;
  entry: CosmeticEntry | null;
  unlocked: boolean;
  checked: boolean;
  onChoose: () => void;
}

function CosmeticOption({ kind, name, entry, unlocked, checked, onChoose }: OptionProps) {
  const hintId = useId();
  const locked = !unlocked;
  return (
    <li>
      <label className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-1 text-sm", locked ? "text-muted" : "cursor-pointer")}>
        <input
          type="radio"
          name={name}
          value={entry?.key ?? STANDARD_LOOK}
          checked={checked}
          disabled={locked}
          aria-describedby={locked ? hintId : undefined}
          onChange={onChoose}
          className="h-4 w-4"
        />
        <span className="min-w-40 font-medium">{entry === null ? COSMETICS_TEXT.none : entry.label}</span>
        <Preview kind={kind} cosmeticKey={entry?.key ?? null} />
        {entry === null ? <span className="text-muted">{COSMETICS_TEXT.noneHint}</span> : null}
        {entry !== null && locked ? (
          <span id={hintId} className="inline-flex items-center gap-1" data-testid="cosmetic-locked">
            <LockGlyph />
            {COSMETICS_TEXT.locked}: {entry.unlockText}
          </span>
        ) : null}
      </label>
    </li>
  );
}

function CosmeticSlot({ kind, unlockedKeys }: { kind: CosmeticKind; unlockedKeys: ReadonlySet<string> }) {
  const choice = useCosmeticsStore((state) => state.choices[kind]);
  const equip = useCosmeticsStore((state) => state.equip);
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm font-semibold">{COSMETIC_SLOT_TITLES[kind]}</legend>
      <ul className="flex flex-col gap-1">
        <CosmeticOption kind={kind} name={name} entry={null} unlocked checked={choice === null || !unlockedKeys.has(choice)} onChoose={() => equip(kind, null)} />
        {cosmeticsOfKind(kind).map((entry) => (
          <CosmeticOption
            key={entry.key}
            kind={kind}
            name={name}
            entry={entry}
            unlocked={unlockedKeys.has(entry.key)}
            checked={choice === entry.key && unlockedKeys.has(entry.key)}
            onChoose={() => equip(kind, entry.key)}
          />
        ))}
      </ul>
    </fieldset>
  );
}

export function CosmeticsSection() {
  const streak = useQuery(streakQuery(useAppApi()));
  let body;
  if (streak.data !== undefined) {
    const unlockedKeys = new Set(streak.data.unlocks.map((unlock) => unlock.cosmetic_key));
    body = COSMETIC_SLOTS.map((kind) => <CosmeticSlot key={kind} kind={kind} unlockedKeys={unlockedKeys} />);
  } else if (streak.isError) {
    body = <LoadError message={COSMETICS_TEXT.failed} retries="your unlocks" onRetry={() => void streak.refetch()} />;
  } else {
    body = <LoadingNote text={COSMETICS_TEXT.loading} />;
  }
  return (
    <SettingsSection title={COSMETICS_TEXT.title} description={COSMETICS_TEXT.note}>
      {body}
    </SettingsSection>
  );
}
