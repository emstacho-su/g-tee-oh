/**
 * The app's provider stack (R3.13): TanStack Query, the api client context and the router.
 * main.tsx renders it for the browser; tests render it with their own router, QueryClient and
 * api so each test is isolated.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

import type { AppApi } from "../api/index.js";
import { ApiProvider } from "../auth/index.js";
import type { AppRouter } from "../router.js";

export interface AppProps {
  router: AppRouter;
  queryClient: QueryClient;
  api: AppApi;
}

export function App({ router, queryClient, api }: AppProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <RouterProvider router={router} />
      </ApiProvider>
    </QueryClientProvider>
  );
}
