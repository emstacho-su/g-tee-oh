/**
 * The configuration list for the reveal's Study this spot link (S46, R3.34, item 11), read once a
 * decision is revealed and cached for the session by the shared configurations query
 * (settings/configs-query.ts). Undefined while it loads (no link yet); null when the read failed,
 * so the screen says the link is unavailable rather than dropping it silently (PR #50 review). The
 * trainer never waits on it.
 */
import { useQuery } from "@tanstack/react-query";

import { useAppApi } from "../auth/index.js";
import type { GameConfig } from "../progress/types.js";
import { allConfigsQuery } from "../routes/settings/configs-query.js";

export type StudyConfigs = readonly GameConfig[] | null | undefined;

export function useStudyConfigs(revealed: boolean): StudyConfigs {
  const configs = useQuery({ ...allConfigsQuery(useAppApi()), enabled: revealed });
  return configs.isError ? null : configs.data;
}
