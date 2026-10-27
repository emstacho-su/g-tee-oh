/**
 * The e2e owner credentials for the stack sign-in flow (R3.13, O-263). infra/compose/e2e.mjs
 * creates a fresh owner per run with a random password and sets E2E_OWNER_EMAIL and
 * E2E_OWNER_PASSWORD in the environment of the e2e-web child only, so `just e2e` never skips
 * the flow. A developer running `just e2e-web` by hand against a stack without those two
 * variables gets a skip with a reason instead of a failure. Nothing here prints the password.
 */
export const OWNER_EMAIL_VARIABLE = "E2E_OWNER_EMAIL";
export const OWNER_PASSWORD_VARIABLE = "E2E_OWNER_PASSWORD";

export interface OwnerCredentials {
  readonly email: string;
  readonly password: string;
}

export type CredentialEnvironment = Readonly<Record<string, string | undefined>>;

/** Both values when both are set and not blank, else undefined. The password is kept verbatim. */
export function ownerCredentials(env: CredentialEnvironment): OwnerCredentials | undefined {
  const email = env[OWNER_EMAIL_VARIABLE]?.trim();
  const password = env[OWNER_PASSWORD_VARIABLE];
  if (email === undefined || email === "" || password === undefined || password.trim() === "") {
    return undefined;
  }
  return { email, password };
}
