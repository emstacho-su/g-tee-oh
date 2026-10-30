/**
 * The drill library's table (S40, R3.14, O-404, screen review row 41): one compact row per drill
 * with a radio to select it, its name, spot summary, stop rule, tags (each a link to the library
 * filtered by it) and a settings gear that opens the drill's builder. The radios form one group
 * (arrow keys move between them); a click anywhere on a row selects it too. The selected row is
 * raised and bold as well as checked, so the choice never rests on colour alone.
 *
 * Phone width (under md): the header row is kept for screen readers only and each row becomes a
 * small grid (radio, then the name with the spot, stop rule and tags under it, then the gear), so
 * the page never scrolls sideways. Every value is rendered once, so a reader meets each cell once.
 *
 * S47 (R3.36, R3.4, O-482, O-484): a Start column opens the run screen with autostart, with the
 * coverage badge under it (DrillRowStart); the Spot column reads in words with the token line as
 * its tooltip; the stop rule keeps its prefix visible below md.
 */
import { Link } from "@tanstack/react-router";
import { useId } from "react";

import { cn, FLAT_REST_CLASS, GearIcon, RAISED_CLASS, TACTILE_CLASS } from "../../components/ui/index.js";
import { STOP_RULE_LABELS } from "../../drills/labels.js";
import { spotSummary, spotWords } from "../../drills/summary.js";
import type { Drill } from "../../drills/types.js";
import { DrillRowStart } from "./DrillRowStart.js";

export const TABLE_TEXT = {
  caption: "Your drills",
  select: "Select",
  name: "Name",
  spot: "Spot",
  stopRule: "Stop rule",
  tags: "Tags",
  settings: "Settings",
  start: "Start",
  noTags: "No tags",
} as const;

export interface DrillTableProps {
  drills: readonly Drill[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}

const HEADER_CLASSES = "px-3 py-2 text-left text-xs font-semibold tracking-wide text-muted uppercase";
const CELL_CLASSES = "px-3 py-2 align-middle md:align-top";
/** Spot, stop rule and tags: their own columns from md, stacked under the name below it. */
const FOLDED_CELL_CLASSES = cn(CELL_CLASSES, "max-md:col-start-2 max-md:py-0 max-md:pb-1");
const GEAR_CLASSES = cn("inline-flex size-9 items-center justify-center rounded-lg text-text hover:bg-surface-sunken", TACTILE_CLASS, FLAT_REST_CLASS);

function TagLinks({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return <span className="text-muted">{TABLE_TEXT.noTags}</span>;
  return (
    <ul aria-label={TABLE_TEXT.tags} className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <li key={tag}>
          <Link
            to="/drills"
            search={{ tag }}
            aria-label={`Show drills tagged ${tag}`}
            className="rounded-full border border-border-strong px-2 text-xs hover:bg-surface-sunken"
          >
            {`#${tag}`}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function DrillRowCells({ drill, group, selected, onSelect }: { drill: Drill; group: string; selected: boolean; onSelect: () => void }) {
  return (
    <>
      <td className={cn(CELL_CLASSES, "max-md:col-start-1 max-md:row-start-1")}>
        <input type="radio" name={group} aria-label={`Select ${drill.name}`} checked={selected} onChange={onSelect} className="size-4 accent-accent" />
      </td>
      <th scope="row" className={cn(CELL_CLASSES, "text-left max-md:col-start-2 max-md:row-start-1", selected ? "font-bold" : "font-medium")}>
        <span data-testid="drill-name">{drill.name}</span>
      </th>
      <td className={cn(FOLDED_CELL_CLASSES, "text-muted md:max-w-md")}>
        {/* Words on the screen, the compact token line as the tooltip (S47 critic, R3.14). */}
        <span data-testid="spot-summary" className="break-words" title={spotSummary(drill.spot_filter)}>
          {spotWords(drill.spot_filter)}
        </span>
      </td>
      <td className={cn(FOLDED_CELL_CLASSES, "whitespace-nowrap")}>
        <span className="text-muted md:sr-only">{`${TABLE_TEXT.stopRule}: `}</span>
        <span data-testid="stop-rule">{STOP_RULE_LABELS[drill.trainer.stop_rule]}</span>
      </td>
      <td className={FOLDED_CELL_CLASSES}>
        <TagLinks tags={drill.tags} />
      </td>
      <td className={cn(FOLDED_CELL_CLASSES, "md:text-right")} onClick={(event) => event.stopPropagation()}>
        <DrillRowStart drill={drill} />
      </td>
      <td className={cn(CELL_CLASSES, "text-right max-md:col-start-3 max-md:row-start-1")}>
        <Link to="/drills/$id/$section" params={{ id: drill.id, section: "details" }} aria-label={`Settings for ${drill.name}`} className={GEAR_CLASSES}>
          <GearIcon />
        </Link>
      </td>
    </>
  );
}

export function DrillTable({ drills, selectedId, onSelect }: DrillTableProps) {
  const group = useId();
  return (
    <table className="w-full border-collapse text-sm max-md:block">
      <caption className="pb-2 text-left text-base font-semibold max-md:block">{TABLE_TEXT.caption}</caption>
      <thead className="max-md:sr-only">
        <tr className="border-b border-border">
          <th scope="col" className={HEADER_CLASSES}>
            <span className="sr-only">{TABLE_TEXT.select}</span>
          </th>
          <th scope="col" className={HEADER_CLASSES}>
            {TABLE_TEXT.name}
          </th>
          <th scope="col" className={HEADER_CLASSES}>
            {TABLE_TEXT.spot}
          </th>
          <th scope="col" className={HEADER_CLASSES}>
            {TABLE_TEXT.stopRule}
          </th>
          <th scope="col" className={HEADER_CLASSES}>
            {TABLE_TEXT.tags}
          </th>
          <th scope="col" className={HEADER_CLASSES}>
            {TABLE_TEXT.start}
          </th>
          <th scope="col" className={HEADER_CLASSES}>
            <span className="sr-only">{TABLE_TEXT.settings}</span>
          </th>
        </tr>
      </thead>
      <tbody className="max-md:flex max-md:flex-col max-md:gap-2">
        {drills.map((drill) => {
          const selected = drill.id === selectedId;
          return (
            <tr
              key={drill.id}
              data-testid="drill-row"
              data-selected={selected ? "true" : "false"}
              onClick={() => onSelect(drill.id)}
              className={cn(
                "cursor-pointer border-b border-border/60 max-md:grid max-md:grid-cols-[auto_minmax(0,1fr)_auto] max-md:rounded-xl max-md:border",
                selected ? cn(RAISED_CLASS, "bg-surface-raised") : "hover:bg-surface-sunken",
              )}
            >
              <DrillRowCells drill={drill} group={group} selected={selected} onSelect={() => onSelect(drill.id)} />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
