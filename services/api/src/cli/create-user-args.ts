/**
 * The testable parts of the create-user command (R3.1, O-233): its arguments, reading the password
 * from standard input, and the one-line failure message. cli/create-user.ts only wires these to the
 * process.
 *
 * Mechanism: the email comes from --email VALUE or --email=VALUE and nothing else is accepted, so a
 * typo fails instead of being ignored. The password never travels as an argument, where the shell
 * history and the process list would show it; it is the first line of standard input, read chunk by
 * chunk until the first line ending (CR LF or LF) or the end of input, and capped in size so a
 * stream without a line ending cannot grow without bound. A failure message is one line and has the
 * password cut out, whatever the error said.
 */
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

export const USAGE = "usage: node dist/create-user.js --email <address>   (the password is read from stdin)";

/** Bad arguments or bad standard input; the message says what to fix. */
export class CreateUserUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreateUserUsageError";
  }
}

export interface CreateUserArgs {
  email: string;
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

/** Parses the command's arguments (process.argv without node and the script). */
export function parseCreateUserArgs(argv: readonly string[]): CreateUserArgs {
  let email: string | undefined;
  let index = 0;
  while (index < argv.length) {
    const argument = argv[index] ?? "";
    if (argument !== EMAIL_FLAG && !argument.startsWith(EMAIL_FLAG_PREFIX)) {
      throw new CreateUserUsageError(`unexpected argument "${argument}". ${USAGE}`);
    }
    if (email !== undefined) {
      throw new CreateUserUsageError(`${EMAIL_FLAG} given more than once. ${USAGE}`);
    }
    const { value, consumed } = emailValue(argv, index);
    email = value;
    index += consumed;
  }
  if (email === undefined || email.trim() === "") {
    throw new CreateUserUsageError(`${EMAIL_FLAG} is required. ${USAGE}`);
  }
  return { email };
}

function chunkText(chunk: unknown): string {
  if (typeof chunk === "string") {
    return chunk;
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk).toString("utf8");
  }
  throw new CreateUserUsageError("standard input is not text.");
}

/** Reads text up to the first line ending; stops reading there. */
async function readUntilLineEnd(input: AsyncIterable<unknown>): Promise<string> {
  let text = "";
  for await (const chunk of input) {
    text += chunkText(chunk);
    if (text.includes(LINE_FEED)) {
      break;
    }
    if (Buffer.byteLength(text, "utf8") > MAX_STDIN_BYTES) {
      throw new CreateUserUsageError(`the password line is longer than ${MAX_STDIN_BYTES} bytes.`);
    }
  }
  return text;
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

/** A one-line description of a failure with every occurrence of the password cut out. */
export function describeFailure(error: unknown, password: string | undefined): string {
  const message = error instanceof Error ? error.message : String(error);
  const redacted = password === undefined || password === "" ? message : message.split(password).join(REDACTED);
  return `${FAILURE_PREFIX}${redacted.replace(/\s*[\r\n]+\s*/g, " ").trim()}`;
}
