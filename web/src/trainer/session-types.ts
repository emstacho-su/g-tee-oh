/**
 * Named aliases for the session and drill contract schemas the trainer uses (S25, S26, R3.13,
 * R3.14, O-38, O-312, O-313). They come from the generated contract types, as src/contracts.ts
 * does for the S24 shapes; they live here because contracts.ts belongs to the S24 foundation and
 * the trainer lane owns this directory.
 */
import type { ApiComponents } from "@g-tee-oh/contracts";

type Schemas = ApiComponents["schemas"];

export type Drill = Schemas["Drill"];
export type PracticeSession = Schemas["PracticeSession"];
export type SessionRecap = Schemas["SessionRecap"];
/** An automated session's current review block and a holdout session's round progress (S32, O-272, O-276). */
export type AutomatedBlock = Schemas["AutomatedBlock"];
export type HoldoutProgress = Schemas["HoldoutProgress"];
export type RatingChange = SessionRecap["rating_changes"][number];
export type StopRule = Schemas["TrainerSettings"]["stop_rule"];
export type PauseRule = Schemas["TrainerSettings"]["pause"];
export type RevealSpeed = Schemas["TrainerSettings"]["speed"];
/** The covered part of a drill that POST /sessions answers (O-312). */
export type SessionCoverage = Schemas["SessionCoverage"];
/** How the last ended hand closed, on every prompt after the first hand ends (O-313). */
export type PreviousHand = Schemas["PreviousHand"];
export type HandEnd = PreviousHand["end"];

/** The trainer settings that shape a run: when a hand stops and whether a reveal pauses (O-314). */
export type RunSettings = Pick<Schemas["TrainerSettings"], "stop_rule" | "pause" | "speed" | "quick_result">;
