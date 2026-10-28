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
/** The threshold card S23 pinned from solver-query's insights (S38 renders it in plain words). */
export type ThresholdCardData = Schemas["ThresholdCard"];
export type TrainerPrompt = Schemas["TrainerPrompt"];
export type TrainerSettings = Schemas["TrainerSettings"];
export type DecisionFeedback = Schemas["DecisionFeedback"];
export type BuilderStatus = Schemas["BuilderStatus"];
// S42 (O-349): invites and joining.
export type InviteSummary = Schemas["InviteSummary"];
export type CreatedInvite = Schemas["CreatedInvite"];
export type InvitePreview = Schemas["InvitePreview"];

export type ActionKind = NodeAction["kind"];
export type Position = TrainerPrompt["hero_position"];
export type Street = StudyNode["street"];
export type FeedbackLabel = DecisionFeedback["label"];
export type NoiseFlag = StudyNode["noise_flags"][number];
export type PanelKey = keyof TrainerSettings["panels"];
export type Grouping = TrainerSettings["grouping"];

// S27 (R3.16 to R3.20, O-303): prediction, range painting, insight cards and explanations.
export type PracticeSession = Schemas["PracticeSession"];
export type PredictionPrompt = Schemas["PredictionPrompt"];
export type PredictionResult = Schemas["PredictionResult"];
export type RangePaintPrompt = Schemas["RangePaintPrompt"];
export type RangePaintResult = Schemas["RangePaintResult"];
export type RangeDrift = Schemas["RangeDrift"];
export type MoreInfo = Schemas["MoreInfo"];
export type AskResult = Schemas["AskResult"];
export type AskStatus = Schemas["AskStatus"];
