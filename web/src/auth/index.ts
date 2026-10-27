/** Session and sign-in layer (R3.13): query client, me query, login and logout, safe redirect. */
export { ApiProvider, useAppApi } from "./api-context.js";
export type { ApiProviderProps } from "./api-context.js";
export { useLogin, useLogout, useMe } from "./hooks.js";
export { createQueryClient, shouldRetryQuery } from "./query-client.js";
export { safeRedirect, SAFE_REDIRECT_FALLBACK } from "./safe-redirect.js";
export { fetchMe, login, logout, ME_QUERY_KEY, meQueryOptions } from "./session.js";
export type { LoginInput } from "./session.js";
