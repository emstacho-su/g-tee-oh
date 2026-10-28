/**
 * Click to drill (S32, R4.12, O-321 as amended by the PM in the S32 plan section 8): a heat map
 * cell, or a leak row through its cell, opens a drill of that class.
 *
 * Mechanism: the class's drill is found by a reserved app-set tag, never by its name: "auto-"
 * plus the first AUTO_TAG_HASH_CHARS hex characters of sha256(spot_class_key), computed with
 * crypto.subtle, which keeps the tag inside the api's tag pattern (S26's TAG_PATTERN). The key is
 * only hashed, never parsed (ADR 0004). openClassDrill lists the drills carrying that tag first,
 * through S26's fetchDrillPage, and reuses the first it finds. Otherwise it reads the format's
 * configs (the study catalog read, so a cached list is reused), builds the body
 * (drill-family.ts), checks it with S26's checkDrillBody (the api's write rules) and creates it
 * with S26's createDrill, which sends AUTO_CSRF_HEADER, under the Idempotency-Key "auto-drill-"
 * plus the full hash. Two clicks, two tabs or a retry for the same class therefore send the same
 * key and the api replays the first answer, so there is never more than one auto drill per class.
 * When no config matches, nothing is created and the result says so; a body the write rules
 * refuse is never sent and its first rule message is reported.
 *
 * useOpenDrill wraps it for the screens: one open at a time, the clicked target's key as pending
 * (its button is disabled), navigation to /drills/$id/run on success, and an inline message for
 * the card that asked when no config matches or a request fails. The failure text is the api
 * problem's title (fixed text per problem type), never its detail (A9 section 3).
 */
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { isApiProblem } from "../api/index.js";
import type { AppApi } from "../api/index.js";
import { useAppApi } from "../auth/index.js";
import { checkDrillBody } from "../drills/body-rules.js";
import { createDrill, fetchDrillPage } from "../drills/queries.js";
import { formatConfigsQuery } from "../study/queries.js";
import { isDrillFormat, leakDrillBody, type DrillSpot } from "./drill-family.js";
import type { GameConfig, HeatmapCell, HeatmapColumn, HeatmapRow } from "./types.js";

export const AUTO_TAG_PREFIX = "auto-";
export const AUTO_TAG_HASH_CHARS = 26;
export const AUTO_IDEMPOTENCY_PREFIX = "auto-drill-";
export const NO_CONFIG_TEXT = "No covered configuration matches this spot";
export const OPEN_FAILED_PREFIX = "Could not open a drill";
export const NETWORK_FAILED_TEXT = "the request did not reach the server. Try again.";

const HEX_RADIX = 16;
const HEX_BYTE_WIDTH = 2;

/** The lowercase hex sha256 of a text. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(HEX_RADIX).padStart(HEX_BYTE_WIDTH, "0")).join("");
}

export function autoDrillTag(hash: string): string {
  return `${AUTO_TAG_PREFIX}${hash.slice(0, AUTO_TAG_HASH_CHARS)}`;
}

export function autoDrillIdempotencyKey(hash: string): string {
  return `${AUTO_IDEMPOTENCY_PREFIX}${hash}`;
}

/** What to open: the class key (hashed for the tag) and its coordinates (for the filter). */
export interface DrillTarget {
  readonly spotClassKey: string;
  readonly spot: DrillSpot;
}

/** The target of a heat map cell: its key and its row's and column's coordinates. */
export function drillTargetOf(cell: HeatmapCell, row: HeatmapRow, column: HeatmapColumn): DrillTarget {
  return {
    spotClassKey: cell.spot_class_key,
    spot: { family: row.family, pair: row.pair, format: column.format, depthBand: column.depth_band },
  };
}

export type OpenDrillResult =
  | { readonly kind: "opened"; readonly drillId: string }
  | { readonly kind: "no-config" }
  | { readonly kind: "refused"; readonly reason: string };

export interface OpenDrillDeps {
  readonly api: AppApi;
  /** Every catalog config of a format, in /configs order. */
  readonly loadConfigs: (format: GameConfig["format"]) => Promise<readonly GameConfig[]>;
}

/** Finds the class's auto drill by tag, or creates it; no-config when no catalog config fits. */
export async function openClassDrill(deps: OpenDrillDeps, target: DrillTarget): Promise<OpenDrillResult> {
  const hash = await sha256Hex(target.spotClassKey);
  const tag = autoDrillTag(hash);
  const existing = (await fetchDrillPage(deps.api, tag, undefined)).items[0];
  if (existing !== undefined) return { kind: "opened", drillId: existing.id };
  if (!isDrillFormat(target.spot.format)) return { kind: "no-config" };
  const body = leakDrillBody(target.spot, tag, await deps.loadConfigs(target.spot.format));
  if (body === null) return { kind: "no-config" };
  const [refusal] = checkDrillBody(body);
  if (refusal !== undefined) return { kind: "refused", reason: refusal.message };
  const created = await createDrill(deps.api, body, autoDrillIdempotencyKey(hash));
  return { kind: "opened", drillId: created.id };
}

/** The inline text for a failed open. */
export function openFailureText(error: unknown): string {
  if (isApiProblem(error)) return `${OPEN_FAILED_PREFIX}: ${error.title}.`;
  return `${OPEN_FAILED_PREFIX}: ${NETWORK_FAILED_TEXT}`;
}

/** The inline text for a result that opened nothing. */
export function unopenedText(result: Exclude<OpenDrillResult, { kind: "opened" }>): string {
  return result.kind === "no-config" ? NO_CONFIG_TEXT : `${OPEN_FAILED_PREFIX}: ${result.reason}`;
}

/** Which card asked, so only that card shows the message. */
export type DrillOrigin = "leaks" | "heatmap";

export interface DrillMessage {
  readonly origin: DrillOrigin;
  readonly text: string;
}

export interface OpenDrillControl {
  open: (target: DrillTarget, origin: DrillOrigin) => void;
  /** The spot_class_key being opened, or null. */
  pendingKey: string | null;
  message: DrillMessage | null;
}

export function useOpenDrill(): OpenDrillControl {
  const api = useAppApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<DrillMessage | null>(null);

  const open = useCallback(
    (target: DrillTarget, origin: DrillOrigin) => {
      if (pendingKey !== null) return;
      setPendingKey(target.spotClassKey);
      setMessage(null);
      const deps: OpenDrillDeps = { api, loadConfigs: (format) => queryClient.fetchQuery(formatConfigsQuery(api, format)) };
      openClassDrill(deps, target)
        .then(async (result) => {
          if (result.kind !== "opened") {
            setMessage({ origin, text: unopenedText(result) });
            return;
          }
          await navigate({ to: "/drills/$id/run", params: { id: result.drillId } });
        })
        .catch((error: unknown) => setMessage({ origin, text: openFailureText(error) }))
        .finally(() => setPendingKey(null));
    },
    [api, queryClient, navigate, pendingKey],
  );

  return { open, pendingKey, message };
}
