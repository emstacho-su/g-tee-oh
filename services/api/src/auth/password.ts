/**
 * Password hashing with argon2id (R3.1, A9 section 3). Node's built-in crypto.argon2 (added in
 * Node 24.7, no stability marker in its section of the v24 docs, so it inherits the crypto
 * module's Stable status, and it emits no warning) does the work, so the api carries no native
 * password dependency. Parameters follow the OWASP Password Storage Cheat Sheet's argon2id
 * minimum: 19 MiB of memory, 2 passes, 1 lane.
 *
 * Mechanism: the hash is stored as a PHC string ($argon2id$v=19$m=...,t=...,p=...$salt$hash, with
 * unpadded standard base64), so the parameters travel with each hash and can be raised later
 * without invalidating older ones. Verification recomputes with the stored parameters and compares
 * in constant time. For an unknown email the caller verifies against DUMMY_PASSWORD_HASH, so a
 * login for a missing account costs the same time as one for a real account.
 */
import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

export const ARGON2_ALGORITHM = "argon2id";
export const ARGON2_VERSION = 19;
/** Memory in KiB: 19 MiB (OWASP minimum for argon2id). */
export const ARGON2_MEMORY_KIB = 19 * 1024;
export const ARGON2_PASSES = 2;
export const ARGON2_PARALLELISM = 1;
export const ARGON2_SALT_BYTES = 16;
export const ARGON2_TAG_BYTES = 32;
/** Upper bounds a stored hash may claim, so a corrupt row cannot ask for unbounded work. */
const MAX_MEMORY_KIB = 1024 * 1024;
const MAX_PASSES = 10;
const MAX_PARALLELISM = 8;

const PHC_PATTERN = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

interface Argon2Parameters {
  memory: number;
  passes: number;
  parallelism: number;
  salt: Buffer;
  tagLength: number;
}

function derive(password: string, parameters: Argon2Parameters): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      ARGON2_ALGORITHM,
      {
        message: password,
        nonce: parameters.salt,
        memory: parameters.memory,
        passes: parameters.passes,
        parallelism: parameters.parallelism,
        tagLength: parameters.tagLength,
      },
      (error, derived) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derived);
      },
    );
  });
}

function toB64(buffer: Buffer): string {
  return buffer.toString("base64").replace(/=+$/, "");
}

function encodePhc(parameters: Argon2Parameters, tag: Buffer): string {
  const { memory, passes, parallelism, salt } = parameters;
  return `$${ARGON2_ALGORITHM}$v=${ARGON2_VERSION}$m=${memory},t=${passes},p=${parallelism}$${toB64(salt)}$${toB64(tag)}`;
}

function decodePhc(phc: string): { parameters: Argon2Parameters; tag: Buffer } | undefined {
  const match = PHC_PATTERN.exec(phc);
  if (match === null) {
    return undefined;
  }
  const [, memory, passes, parallelism, salt, tag] = match;
  const parameters = {
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    salt: Buffer.from(salt ?? "", "base64"),
    tagLength: Buffer.from(tag ?? "", "base64").length,
  };
  const withinBounds =
    parameters.memory >= 8 * parameters.parallelism &&
    parameters.memory <= MAX_MEMORY_KIB &&
    parameters.passes >= 1 &&
    parameters.passes <= MAX_PASSES &&
    parameters.parallelism >= 1 &&
    parameters.parallelism <= MAX_PARALLELISM &&
    parameters.salt.length >= 8 &&
    parameters.tagLength >= 4;
  return withinBounds ? { parameters, tag: Buffer.from(tag ?? "", "base64") } : undefined;
}

/** Hashes a password into a PHC string with a fresh random salt. */
export async function hashPassword(password: string): Promise<string> {
  const parameters: Argon2Parameters = {
    memory: ARGON2_MEMORY_KIB,
    passes: ARGON2_PASSES,
    parallelism: ARGON2_PARALLELISM,
    salt: randomBytes(ARGON2_SALT_BYTES),
    tagLength: ARGON2_TAG_BYTES,
  };
  return encodePhc(parameters, await derive(password, parameters));
}

/**
 * True when the password matches the stored PHC string. A string that is not a well-formed
 * argon2id PHC hash within the bounds above never matches.
 */
export async function verifyPassword(phc: string, password: string): Promise<boolean> {
  const decoded = decodePhc(phc);
  if (decoded === undefined) {
    return false;
  }
  const derived = await derive(password, decoded.parameters);
  return derived.length === decoded.tag.length && timingSafeEqual(derived, decoded.tag);
}

/**
 * A fixed hash of a random password nobody knows, verified against when the email is unknown so
 * the response time does not reveal whether an account exists.
 */
export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c2EzcGQ0bW15c2FsdDEyMw$wF0ZRkBQ1uYQ1u8dV1wq7c2J0b3ZQd1h6a3J0dGVzdA";
