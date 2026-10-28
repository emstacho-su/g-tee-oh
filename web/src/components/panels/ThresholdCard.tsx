/**
 * The threshold card study panel (S24, A7, R3.12). It shows StudyInsights.threshold_card, whose
 * inner shape S23 pins, so the card renders any JSON value generically and safely: an object
 * becomes a definition list with readable keys (underscores become spaces), an array a list,
 * and a string, number, boolean or null plain text. Every value goes through React text nodes,
 * never HTML, so a string from the api cannot inject markup. Nesting stops at a depth limit. A
 * value equal to the hero's hand is marked so the hero finds it. An empty object says "No
 * threshold data for this node".
 */
import { useId, type ReactNode } from "react";

export interface ThresholdCardProps {
  /** Null when solver-query has no threshold card at the node (S23 pinned shape). */
  card: Readonly<Record<string, unknown>> | null;
  heroHand?: string;
  title?: string;
}

/** Deeper values are summarized; real threshold cards are two or three levels deep. */
export const MAX_DEPTH = 6;
const DEFAULT_TITLE = "Threshold card";

function readableKey(key: string): string {
  return key.replace(/_/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function primitiveText(value: unknown): string | null {
  if (value === null) return "none";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

function renderValue(value: unknown, depth: number, heroHand: string | undefined): ReactNode {
  const text = primitiveText(value);
  if (text !== null) {
    return heroHand !== undefined && text === heroHand ? (
      <mark data-hero="true" className="rounded bg-accent px-1 text-accent-text">
        {text}
      </mark>
    ) : (
      <span>{text}</span>
    );
  }
  if (depth >= MAX_DEPTH && (Array.isArray(value) || isRecord(value))) {
    return <span className="text-muted">nested too deep</span>;
  }
  if (Array.isArray(value)) {
    return (
      <ul className="flex flex-wrap gap-1">
        {value.map((item, index) => (
          <li key={index} className="rounded bg-surface-sunken px-1">
            {renderValue(item, depth + 1, heroHand)}
          </li>
        ))}
      </ul>
    );
  }
  if (isRecord(value)) return renderRecord(value, depth + 1, heroHand);
  return <span className="text-muted">unsupported value</span>;
}

function renderRecord(record: Record<string, unknown>, depth: number, heroHand: string | undefined): ReactNode {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      {Object.entries(record).map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-muted">{readableKey(key)}</dt>
          <dd>{renderValue(value, depth, heroHand)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ThresholdCard({ card, heroHand, title = DEFAULT_TITLE }: ThresholdCardProps) {
  const titleId = useId();
  const empty = card === null || Object.keys(card).length === 0;
  return (
    <section data-testid="threshold-card" aria-labelledby={titleId} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-4 text-sm">
      <h3 id={titleId} className="font-semibold">
        {title}
      </h3>
      {heroHand === undefined ? null : <p>{`Your hand: ${heroHand}`}</p>}
      {empty ? <p className="text-muted">No threshold data for this node</p> : renderRecord({ ...card }, 1, heroHand)}
    </section>
  );
}
