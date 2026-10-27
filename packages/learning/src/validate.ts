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

/** A value from a fixed list of spellings, or a RangeError naming the field. */
export function requireOneOf<T extends string>(value: T, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value)) {
    throw new RangeError(`${field} must be one of ${allowed.join(", ")}, got ${String(value)}`);
  }
  return value;
}
