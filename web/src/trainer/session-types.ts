/**
 * Named aliases for the session and drill contract schemas the trainer uses (S25, R3.13, O-38).
 * They come from the generated contract types, as src/contracts.ts does for the S24 shapes; they
 * live here because contracts.ts belongs to the S24 foundation and the trainer lane owns this
 * directory.
 */
import type { ApiComponents } from "@g-tee-oh/contracts";

type Schemas = ApiComponents["schemas"];

export type Drill = Schemas["Drill"];
export type PracticeSession = Schemas["PracticeSession"];
export type SessionRecap = Schemas["SessionRecap"];
export type StopRule = Schemas["TrainerSettings"]["stop_rule"];
