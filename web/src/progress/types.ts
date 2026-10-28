/**
 * Named aliases for the progress contract schemas (S32, R4.12, S31's six /progress routes). Every
 * type comes from the generated contract (packages/contracts), so a contract change is a type
 * error here, never a silent drift. Kept apart from src/contracts.ts so the progress screens add
 * no lines to a file other sessions edit.
 */
import type { ApiComponents } from "@g-tee-oh/contracts";

type Schemas = ApiComponents["schemas"];

export type ProgressRating = Schemas["ProgressRating"];
export type OverallRating = NonNullable<ProgressRating["overall"]>;
export type Tier = OverallRating["tier"];
export type TrackProgress = Schemas["TrackProgress"];
export type TrackKey = TrackProgress["track_key"];
export type ProgressTracks = Schemas["ProgressTracks"];
export type ProgressLeaks = Schemas["ProgressLeaks"];
export type LeakItem = ProgressLeaks["items"][number];
export type LeakPoint = LeakItem["series"][number];
export type ProgressHeatmap = Schemas["ProgressHeatmap"];
export type HeatmapRow = ProgressHeatmap["rows"][number];
export type HeatmapColumn = ProgressHeatmap["columns"][number];
export type HeatmapCell = ProgressHeatmap["cells"][number];
export type ProgressHoldout = Schemas["ProgressHoldout"];
export type HoldoutRound = Schemas["HoldoutRound"];
export type HoldoutTrack = HoldoutRound["tracks"][number];
export type OpenHoldoutRound = NonNullable<ProgressHoldout["open"]>;
export type ProgressStreak = Schemas["ProgressStreak"];
export type StreakUnlock = ProgressStreak["unlocks"][number];
export type SessionRecap = Schemas["SessionRecap"];
export type GameConfig = Schemas["GameConfig"];

/** The weeks the leak-cost trend can span (O-320); the api's default and maximum allow these. */
export const LEAK_WEEK_OPTIONS = [4, 8, 26] as const;
export type LeakWeeks = (typeof LEAK_WEEK_OPTIONS)[number];
export const DEFAULT_LEAK_WEEKS: LeakWeeks = 8;
