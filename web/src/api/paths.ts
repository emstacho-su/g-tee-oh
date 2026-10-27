/**
 * The api paths and header the web's session handling names directly (R3.13, O-230). Everything
 * else reaches the api through the typed client, whose paths the contract checks.
 */
export const API_PATHS = {
  me: "/api/v1/me",
  login: "/api/v1/auth/login",
  logout: "/api/v1/auth/logout",
} as const;

export const CSRF_HEADER = "x-csrf-token";
