/**
 * What every route's beforeLoad receives (R3.13): the QueryClient and the app api client, so the
 * authenticated layout and /login can ensure the me query without reaching for globals.
 */
import type { QueryClient } from "@tanstack/react-query";

import type { AppApi } from "../api/index.js";

export interface RouterContext {
  queryClient: QueryClient;
  api: AppApi;
}
