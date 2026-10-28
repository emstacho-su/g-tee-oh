/**
 * Named aliases for the drill contract schemas the drill screens use (S26, R3.14, O-38). Every
 * type comes from the generated contract (packages/contracts/src/api.generated.ts), so a schema
 * change in services/api/src/schemas/drills.ts shows up here as a type error. They live here
 * because src/contracts.ts belongs to the S24 foundation and this lane owns src/drills.
 */
import type { ApiComponents, ApiPaths } from "@g-tee-oh/contracts";

type Schemas = ApiComponents["schemas"];

export type Drill = Schemas["Drill"];
export type DrillCreate = ApiPaths["/api/v1/drills"]["post"]["requestBody"]["content"]["application/json"];
export type DrillPatch = ApiPaths["/api/v1/drills/{id}"]["patch"]["requestBody"]["content"]["application/json"];
export type DrillPage = ApiPaths["/api/v1/drills"]["get"]["responses"]["200"]["content"]["application/json"];
export type DrillExport = ApiPaths["/api/v1/drills/{id}/export"]["get"]["responses"]["200"]["content"]["application/json"];
export type DrillImport = ApiPaths["/api/v1/drills/import"]["post"]["requestBody"]["content"]["application/json"];
export type SpotFilter = Schemas["SpotFilterWrite"];
export type TrainerSettings = Schemas["TrainerSettings"];

export type GameFormat = SpotFilter["game_config"]["format"];
export type Position = SpotFilter["hero_positions"][number];
export type PreflopAction = SpotFilter["preflop_action"][number];
export type StartStreet = SpotFilter["start_street"];
export type Sizing = SpotFilter["sizing"];
export type HandsFilter = SpotFilter["hands"];
export type HandsMode = HandsFilter["mode"];
export type BoardFilter = NonNullable<SpotFilter["board"]>;
export type HighCard = NonNullable<BoardFilter["high_card"]>;
export type BoardSuits = NonNullable<BoardFilter["suits"]>;
export type BoardConnectivity = NonNullable<BoardFilter["connectivity"]>;
export type StopRule = TrainerSettings["stop_rule"];
export type TrainerInput = TrainerSettings["input"];
export type Grouping = TrainerSettings["grouping"];
export type PauseRule = TrainerSettings["pause"];
export type Speed = TrainerSettings["speed"];
export type Timebank = TrainerSettings["timebank_s"];
export type PanelKey = keyof TrainerSettings["panels"];

/** One field error as the api's validation problem lists it (Problem.errors). */
export interface FieldError {
  /** Dotted path, prefixed by its location on the server ("body.spot_filter.stake"). */
  readonly path: string;
  readonly message: string;
}
