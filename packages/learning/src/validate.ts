/**
 * Input checks shared by the policy modules (S22). The package is pure and services/api is its
 * only caller, but the numbers it grades come from solver-query and the database, so every public
 * function checks its arguments and throws a RangeError naming the field instead of grading
 * nonsense. The messages carry field names and offending values only, nothing user-specific.
 */

/** A finite number at or above zero, or a RangeError naming the field. */
export function requireNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a finite number at or above 0, got ${value}`);
  }
  return value;
}

/** An integer from min to max inclusive, or a RangeError naming the field. */
export function requireIntegerInRange(value: number, min: number, max: number, field: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${field} must be an integer from ${min} to ${max}, got ${value}`);
  }
  return value;
}

/** A non-negative integer, or a RangeError naming the field. */
export function requireCount(value: number, field: string): number {
  return requireIntegerInRange(value, 0, Number.MAX_SAFE_INTEGER, field);
}

/**
 * A frequency list with at least one played action: every entry finite and at or above zero, and
 * a positive sum. Returns the sum, which the band mapping normalizes by.
 */
export function requireFrequencies(frequencies: readonly number[], field: string): number {
  if (frequencies.length === 0) {
    throw new RangeError(`${field} must list at least one action`);
  }
  frequencies.forEach((frequency, index) => requireNonNegative(frequency, `${field}[${index}]`));
  const total = frequencies.reduce((sum, frequency) => sum + frequency, 0);
  if (total <= 0) {
    throw new RangeError(`${field} must have a positive sum, got ${total}`);
  }
  return total;
}

/** A boolean, or a RangeError naming the field. */
export function requireBoolean(value: boolean, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new RangeError(`${field} must be true or false, got ${String(value)}`);
  }
  return value;
}

/**
 * Whether a value is a list at run time. A plain boolean rather than a type guard, because
 * Array.isArray as a guard narrows a readonly typed list to any[].
 */
export function isList(value: unknown): boolean {
  return Array.isArray(value);
}

/** A list of strings, or a RangeError naming the field. */
export function requireStringList(value: readonly string[], field: string): readonly string[] {
  if (!isList(value) || !value.every((entry) => typeof entry === "string")) {
    throw new RangeError(`${field} must be a list of strings`);
  }
  return value;
}

/** The list's element at index, or a RangeError naming the field when there is none. */
export function elementAt<T>(list: readonly T[], index: number, field: string): T {
  const element = list[index];
  if (element === undefined) {
    throw new RangeError(`${field} has no element ${index}`);
  }
  return element;
}

/** A value from a fixed list of spellings, or a RangeError naming the field. */
export function requireOneOf<T extends string>(value: T, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value)) {
    throw new RangeError(`${field} must be one of ${allowed.join(", ")}, got ${String(value)}`);
  }
  return value;
}

/** A finite number, or a RangeError naming the field. */
export function requireFinite(value: number, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${field} must be a finite number, got ${String(value)}`);
  }
  return value;
}

/** A finite number from 0 to 1 inclusive (a probability, a share or a score), or a RangeError naming the field. */
export function requireUnitInterval(value: number, field: string): number {
  if (requireFinite(value, field) < 0 || value > 1) {
    throw new RangeError(`${field} must be a finite number from 0 to 1, got ${value}`);
  }
  return value;
}

/** A non-empty string such as a spot class, track or family key, or a RangeError naming the field. */
export function requireKey(value: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RangeError(`${field} must be a non-empty string, got ${String(value)}`);
  }
  return value;
}

/** A list, or a RangeError naming the field. */
export function requireList<T>(value: readonly T[], field: string): readonly T[] {
  if (!isList(value)) {
    throw new RangeError(`${field} must be a list`);
  }
  return value;
}

/** A non-null object, or a RangeError naming the field. */
export function requireRecord(value: unknown, field: string): void {
  if (typeof value !== "object" || value === null) {
    throw new RangeError(`${field} must be an object`);
  }
}
