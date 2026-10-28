/**
 * Named aliases for the api contract schemas the web uses (S24, O-38, O-115). Every type comes
 * from packages/contracts/src/api.generated.ts, which openapi-typescript generates from the
 * committed api.openapi.json, so a contract change shows up here as a type error instead of a
 * silent shape drift. Nothing in the web redeclares a payload by hand.
 */
import type { ApiComponents } from "@g-tee-oh/contracts";

type Schemas = ApiComponents["schemas"];

export type SessionInfo = Schemas["SessionInfo"];
export type Problem = Schemas["Problem"];
/** The POST /sessions 422 no-coverage problem with its pairs_total and pairs_queued (O-318). */
export type NoCoverageProblemBody = Schemas["NoCoverageProblem"];
export type NodeAction = Schemas["NodeAction"];
export type NodeHandRow = Schemas["NodeHandRow"];
export type StudyNode = Schemas["StudyNode"];
export type StudyInsights = Schemas["StudyInsights"];
export type TrainerPrompt = Schemas["TrainerPrompt"];
export type TrainerSettings = Schemas["TrainerSettings"];
export type DecisionFeedback = Schemas["DecisionFeedback"];
export type BuilderStatus = Schemas["BuilderStatus"];

export type ActionKind = NodeAction["kind"];
export type Position = TrainerPrompt["hero_position"];
export type Street = StudyNode["street"];
export type FeedbackLabel = DecisionFeedback["label"];
export type NoiseFlag = StudyNode["noise_flags"][number];
export type PanelKey = keyof TrainerSettings["panels"];
export type Grouping = TrainerSettings["grouping"];
