/**
 * The catalog spot the quiz and painting pickers choose (S41, R3.16, R3.17, O-33, O-415, O-416).
 *
 * Mechanism: the pickers read the configurations (GET /configs, settings' allConfigsQuery) and the
 * chosen configuration's position pairs (GET /configs/{id}/pairs, practicePairsQuery). Only a
 * configuration without an ante is offered, the v1 served set the api accepts (O-33). A seat is
 * covered when any pair with preflop_available holds it, so the start screen can disable a seat the
 * library has nothing for before a start is refused; the api checks coverage again and queues what
 * is missing (O-240). The five spot types are the preflop families O-416 offers, in plain words.
 * Pure helpers return new arrays and never change their input.
 */
import { queryOptions } from "@tanstack/react-query";
import type { ApiComponents } from "@g-tee-oh/contracts";

import { problemFromBody, type AppApi } from "../api/index.js";
import type { Position } from "../contracts.js";
import type { GameConfig } from "../progress/types.js";
import type { ConfigScope } from "../store/session-defaults.js";

type Schemas = ApiComponents["schemas"];

export type CatalogSpot = Schemas["CatalogSpot"];
export type QuizOptions = Schemas["QuizOptions"];
export type SpotType = CatalogSpot["spot_types"][number];
export type PositionPairEntry = Schemas["PositionPairEntry"];

export interface SpotTypeOption {
  readonly value: SpotType;
  readonly label: string;
}

/** The spot types the pickers offer (O-416), in this order. */
export const SPOT_TYPE_OPTIONS: readonly SpotTypeOption[] = [
  { value: "rfi", label: "Open" },
  { value: "vs_open", label: "Facing an open" },
  { value: "vs_three_bet", label: "Facing a 3-bet" },
  { value: "squeeze", label: "Squeeze" },
  { value: "four_bet", label: "Facing a 4-bet" },
];

export const SPOT_TYPES: readonly SpotType[] = SPOT_TYPE_OPTIONS.map((option) => option.value);

/** Every position the contract names, in gto-model's seat order. */
export const POSITIONS: readonly Position[] = ["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"];

/** The api's largest page; a 9-handed table has 36 pairs, so one page holds them all. */
const PAIRS_PAGE_LIMIT = 200;
/** The catalog changes only when the owner adds configurations or builds; half an hour is fresh enough. */
const PAIRS_STALE_MS = 30 * 60 * 1000;

export function practicePairsQuery(api: AppApi, configId: string) {
  return queryOptions({
    queryKey: ["practice", "pairs", configId] as const,
    queryFn: async (): Promise<PositionPairEntry[]> => {
      const { data, error, response } = await api.client.GET("/api/v1/configs/{id}/pairs", {
        params: { path: { id: configId }, query: { limit: PAIRS_PAGE_LIMIT } },
      });
      if (data === undefined) throw problemFromBody(response.status, error);
      return data.items;
    },
    staleTime: PAIRS_STALE_MS,
    retry: false,
  });
}

/** The configurations v1 serves: no ante (O-33). */
export function servedConfigs(configs: readonly GameConfig[]): GameConfig[] {
  return configs.filter((config) => config.ante_cbb === 0);
}

/** The session defaults' first configuration when the scope is a list and it is served, else the first served one. */
export function defaultConfigId(configs: readonly GameConfig[], scope: ConfigScope): string | null {
  const preferred = typeof scope === "string" ? undefined : scope[0];
  const found = configs.find((config) => config.config_id === preferred) ?? configs[0];
  return found?.config_id ?? null;
}

/** The seated positions any available pair holds, in seat order. */
export function coveredSeats(pairs: readonly PositionPairEntry[], seated: readonly Position[]): Position[] {
  const covered = new Set(pairs.filter((pair) => pair.preflop_available).flatMap((pair) => [pair.oop, pair.ip]));
  return seated.filter((seat) => covered.has(seat));
}

/** The seats that share an available pair with the hero, in seat order. */
export function opponentSeats(pairs: readonly PositionPairEntry[], hero: Position, seated: readonly Position[]): Position[] {
  const opponents = new Set(
    pairs.filter((pair) => pair.preflop_available && (pair.oop === hero || pair.ip === hero)).map((pair) => (pair.oop === hero ? pair.ip : pair.oop)),
  );
  return seated.filter((seat) => opponents.has(seat));
}

export function isPosition(value: string): value is Position {
  return (POSITIONS as readonly string[]).includes(value);
}

export function isSpotType(value: string): value is SpotType {
  return (SPOT_TYPES as readonly string[]).includes(value);
}
