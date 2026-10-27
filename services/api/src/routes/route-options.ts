/** The options buildApp passes to the S23 route plugins: the process configuration. */
import type { AppConfig } from "../config.js";

export interface ConfiguredRouteOptions {
  config: AppConfig;
}
