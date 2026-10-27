/**
 * Safe post-login redirect (R3.13, A9 section 3). The login page's redirect search value comes
 * from the URL, so anyone can craft it; following it blindly would make the app an open
 * redirect. safeRedirect returns the value only when it is a same-origin relative path that
 * starts with exactly one "/", and "/" otherwise.
 *
 * Rejected: anything not a string, empty or over the length cap; anything not starting with "/";
 * a second leading "/" (protocol-relative "//host"); any backslash (browsers treat "\" as "/");
 * any whitespace or control character (browsers strip tabs and newlines, so "/\t/host" becomes
 * "//host"); percent-encoded "/", "\", "%" (double encoding) and control characters; text that
 * does not percent-decode; and, as a last check, anything the URL parser resolves to another origin.
 */

export const SAFE_REDIRECT_FALLBACK = "/";

const MAX_REDIRECT_LENGTH = 2048;
const PROBE_ORIGIN = "http://safe-redirect.invalid";
const WHITESPACE_OR_BACKSLASH = /[\s\\]/u;
/** %2F (/), %5C (\), %25 (%, double encoding), %00 to %1F and %7F (control characters). */
const ENCODED_FORBIDDEN = /%(?:2f|5c|25|[01][0-9a-f]|7f)/i;
const LAST_CONTROL_CODE = 0x1f;
const DELETE_CODE = 0x7f;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= LAST_CONTROL_CODE || code === DELETE_CODE) return true;
  }
  return false;
}

function decodesCleanly(value: string): boolean {
  try {
    decodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

function staysOnOrigin(value: string): boolean {
  try {
    return new URL(value, PROBE_ORIGIN).origin === PROBE_ORIGIN;
  } catch {
    return false;
  }
}

function isSafePath(value: string): boolean {
  if (value.length === 0 || value.length > MAX_REDIRECT_LENGTH) return false;
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (WHITESPACE_OR_BACKSLASH.test(value) || hasControlCharacter(value)) return false;
  if (ENCODED_FORBIDDEN.test(value) || !decodesCleanly(value)) return false;
  return staysOnOrigin(value);
}

/** The redirect value when it is a safe same-origin path, else "/". */
export function safeRedirect(value: unknown): string {
  return typeof value === "string" && isSafePath(value) ? value : SAFE_REDIRECT_FALLBACK;
}
