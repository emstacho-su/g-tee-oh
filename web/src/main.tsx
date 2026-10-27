/**
 * Browser entry point for the web single-page app (R0.7, R3.13). index.html loads this module,
 * which applies the theme class before the first render (so a dark-theme user never sees a light
 * flash, O-266), builds the QueryClient, the router over the page's api client, and mounts the
 * provider stack into #root. The router lives in router.tsx and the providers in app/App.tsx so
 * the vitest suite builds both with a memory history and an injected fetch instead.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { getAppApi } from "./api/index.js";
import { App } from "./app/index.js";
import { createQueryClient } from "./auth/index.js";
import { createAppRouter } from "./router.js";
import { applyThemeClass, useThemeStore } from "./store/index.js";
import "./styles.css";

const MOUNT_ELEMENT_ID = "root";

const container = document.getElementById(MOUNT_ELEMENT_ID);
if (container === null) {
  throw new Error(`web: index.html has no element with id "${MOUNT_ELEMENT_ID}" to mount into`);
}

applyThemeClass(useThemeStore.getState().theme);

const queryClient = createQueryClient();
const api = getAppApi();
const router = createAppRouter({ queryClient, api });

createRoot(container).render(
  <StrictMode>
    <App router={router} queryClient={queryClient} api={api} />
  </StrictMode>,
);
