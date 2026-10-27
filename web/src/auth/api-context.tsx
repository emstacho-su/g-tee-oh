/**
 * React context carrying the app api client to hooks (R3.13). The app and the tests put their own
 * AppApi in the provider; outside a provider useAppApi falls back to the page's singleton.
 */
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import { getAppApi } from "../api/index.js";
import type { AppApi } from "../api/index.js";

const ApiContext = createContext<AppApi | null>(null);

export interface ApiProviderProps {
  api: AppApi;
  children: ReactNode;
}

export function ApiProvider({ api, children }: ApiProviderProps) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useAppApi(): AppApi {
  return useContext(ApiContext) ?? getAppApi();
}
