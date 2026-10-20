/**
 * Process configuration read at the boundary (R0.7). Only API_PORT exists so far; A5 section 1
 * fixes the listen address to every interface inside the compose network, which Caddy fronts.
 */
import { z } from "zod";

export const DEFAULT_API_PORT = 8080;
export const LISTEN_HOST = "0.0.0.0";

const MIN_PORT = 1;
const MAX_PORT = 65535;

const portSchema = z
  .string()
  .regex(/^[0-9]+$/, "base-10 digits only")
  .transform((digits) => Number(digits))
  .pipe(z.number().int().min(MIN_PORT).max(MAX_PORT));

/** Parses API_PORT; an unset or blank value means the default, anything else must be a port. */
export function parseApiPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_API_PORT;
  }
  const result = portSchema.safeParse(raw.trim());
  if (!result.success) {
    throw new Error(`API_PORT must be an integer between ${MIN_PORT} and ${MAX_PORT}, got "${raw}"`);
  }
  return result.data;
}
