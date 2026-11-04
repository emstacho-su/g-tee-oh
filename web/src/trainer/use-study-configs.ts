/**
 * The configuration list for the reveal's Study this spot link (S46, R3.34, item 11), read once a
 * decision is revealed and cached for the session by the shared configurations query
 * (settings/configs-query.ts). Absent while it loads or after a failure, and then the link stays
 * hidden; the trainer never waits on it.
 */
import { useQuery } from "@tanstack/react-query";

import { useAppApi } from "../auth/index.js";
import type { GameConfig } from "../progress/types.js";
import { allConfigsQuery } from "../routes/settings/configs-query.js";

export function useStudyConfigs(revealed: boolean): readonly GameConfig[] | undefined {
  const configs = useQuery({ ...allConfigsQuery(useAppApi()), enabled: revealed });
  return configs.data;
}
