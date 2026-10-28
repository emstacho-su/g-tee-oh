/**
 * The testable parts of the create-user command (R3.1, O-233): its arguments, reading the password
 * from standard input, and the one-line failure message. cli/create-user.ts only wires these to the
 * process.
 *
 * Mechanism: the email comes from --email VALUE or --email=VALUE, and the optional bare --admin flag
 * makes the account an admin (O-242); nothing else is accepted, so a typo fails instead of being
 * ignored. The password never travels as an argument, where the shell
 * history and the process list would show it; it is the first line of standard input, read chunk by
 * chunk until the first line ending (CR LF or LF) or the end of input, and capped in size so a
 * stream without a line ending cannot grow without bound. A failure message is one line and has the
 * password cut out, whatever the error said.
 */
import { StringDecoder } from "node:string_decoder";

import { MAX_PASSWORD_LENGTH } from "../schemas/auth.js";

export const EMAIL_FLAG = "--email";
const EMAIL_FLAG_PREFIX = `${EMAIL_FLAG}=`;
const FLAG_PREFIX = "--";
const LINE_FEED = "\n";
const TRAILING_CARRIAGE_RETURN = /\r$/;
/** The most input read while looking for the first line: the longest password, at 4 bytes a character. */
export const MAX_STDIN_BYTES = MAX_PASSWORD_LENGTH * 4;
const FAILURE_PREFIX = "create-user failed: ";
const REDACTED = "[redacted]";

/** Makes the new account an admin of the builder endpoints (O-242). */
export const ADMIN_FLAG = "--admin";

export const USAGE =
  "usage: node dist/create-user.js --email <address> [--admin]   (the password is read from stdin)";

/** Bad arguments or bad standard input; the message says what to fix. */
export class CreateUserUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreateUserUsageError";
  }
}

export interface CreateUserArgs {
  email: string;
  /** Set app_user.is_admin (O-242). */
  admin: boolean;
}

function emailValue(argv: readonly string[], index: number): { value: string; consumed: number } {
  const argument = argv[index] ?? "";
  if (argument.startsWith(EMAIL_FLAG_PREFIX)) {
    return { value: argument.slice(EMAIL_FLAG_PREFIX.length), consumed: 1 };
  }
  const next = argv[index + 1];
  if (next === undefined || next.startsWith(FLAG_PREFIX)) {
    throw new CreateUserUsageError(`${EMAIL_FLAG} needs a value. ${USAGE}`);
  }
  return { value: next, consumed: 2 };
}

function isEmailFlag(argument: string): boolean {
  return argument === EMAIL_FLAG || argument.startsWith(EMAIL_FLAG_PREFIX);
}

function onlyOnce(seen: boolean, flag: string): void {
  if (seen) {
    throw new CreateUserUsageError(`${flag} given more than once. ${USAGE}`);
  }
}

/** Parses the command's arguments (process.argv without node and the script). */
export function parseCreateUserArgs(argv: readonly string[]): CreateUserArgs {
  let email: string | undefined;
  let admin = false;
  let index = 0;
  while (index < argv.length) {
    const argument = argv[index] ?? "";
    if (argument === ADMIN_FLAG) {
      onlyOnce(admin, ADMIN_FLAG);
      admin = true;
      index += 1;
      continue;
    }
    if (!isEmailFlag(argument)) {
      throw new CreateUserUsageError(`unexpected argument "${argument}". ${USAGE}`);
    }
    onlyOnce(email !== undefined, EMAIL_FLAG);
    const { value, consumed } = emailValue(argv, index);
    email = value;
    index += consumed;
  }
  if (email === undefined || email.trim() === "") {
    throw new CreateUserUsageError(`${EMAIL_FLAG} is required. ${USAGE}`);
  }
  return { email, admin };
}

/**
 * Decodes one chunk. Byte chunks go through one StringDecoder for the whole stream, which holds
 * back the bytes of a character split across two chunks until the rest arrives, so a multibyte
 * character in a password survives any chunking.
 */
function chunkText(chunk: unknown, decoder: StringDecoder): string {
  if (typeof chunk === "string") {
    return chunk;
  }
  if (chunk instanceof Uint8Array) {
    return decoder.write(Buffer.from(chunk));
  }
  throw new CreateUserUsageError("standard input is not text.");
}

/** Reads text up to the first line ending; stops reading there. */
async function readUntilLineEnd(input: AsyncIterable<unknown>): Promise<string> {
  const decoder = new StringDecoder("utf8");
  let text = "";
  for await (const chunk of input) {
    text += chunkText(chunk, decoder);
    if (text.includes(LINE_FEED)) {
      break;
    }
    if (Buffer.byteLength(text, "utf8") > MAX_STDIN_BYTES) {
      throw new CreateUserUsageError(`the password line is longer than ${MAX_STDIN_BYTES} bytes.`);
    }
  }
  // Input that ends mid-character keeps the replacement character, never silently drops bytes.
  return text + decoder.end();
}

/** The first line of the input without its line ending; empty input is an error. */
export async function readFirstLine(input: AsyncIterable<unknown>): Promise<string> {
  const text = await readUntilLineEnd(input);
  const [firstLine = ""] = text.split(LINE_FEED);
  const line = firstLine.replace(TRAILING_CARRIAGE_RETURN, "");
  if (line === "") {
    throw new CreateUserUsageError("no password on standard input: pipe it in as the first line.");
  }
  return line;
}

/**
 * A one-line description of a failure with every occurrence of each secret (the password, and for
 * --admin the owner connection URL and its password) cut out.
 */
export function describeFailure(error: unknown, ...secrets: readonly (string | undefined)[]): string {
  const message = error instanceof Error ? error.message : String(error);
  // Longest first, so a secret that contains another is cut out whole.
  const present = secrets
    .filter((secret): secret is string => secret !== undefined && secret !== "")
    .sort((left, right) => right.length - left.length);
  const redacted = present.reduce((text, secret) => text.split(secret).join(REDACTED), message);
  return `${FAILURE_PREFIX}${redacted.replace(/\s*[\r\n]+\s*/g, " ").trim()}`;
}
