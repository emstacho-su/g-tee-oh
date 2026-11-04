/**
 * Configurations for the depth step tests (S45, R3.12): three online 6-max depths at one stake, and
 * a 9-player and a live configuration that never count as siblings. Synthetic values only.
 */
import type { GameConfig } from "../../src/study/queries.js";

export const fixtureOnlineStake = "00000000-0000-4000-8000-0000000000a1";

function config(configId: string, depth: number, overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    config_id: configId,
    format: "online",
    table_size: 6,
    stake_id: fixtureOnlineStake,
    stake_label: "online",
    depth_cbb: depth,
    straddle: false,
    ante_cbb: 0,
    ...overrides,
  };
}

export const fixtureConfigs: readonly GameConfig[] = [
  config("cfg_6_online_200", 20000),
  config("cfg_6_online_100", 10000),
  config("cfg_6_online_300", 30000),
  config("cfg_9_online_100", 10000, { table_size: 9 }),
  config("cfg_6_live_100", 10000, { format: "live" }),
];
