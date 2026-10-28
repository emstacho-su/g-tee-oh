/**
 * Local calendar days in APP_TIME_ZONE (R4.13, R4.14, O-247, O-276, O-278): pure helpers the streak
 * rules, the holdout round months and their job schedules share. A day is an ISO date string
 * (YYYY-MM-DD) in the configured time zone; days end at local midnight.
 *
 * Mechanism: the local date of an instant is read with Intl.DateTimeFormat in the zone. The instant
 * of a local midnight is found from the zone's offset: guess the UTC instant with the same wall
 * time, subtract the zone's offset there, and correct once more with the offset at the result, which
 * settles a daylight saving change on either side. Date arithmetic on ISO dates runs in UTC, where
 * every day has 24 hours, so adding days never drifts.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Sunday is day 0 of Date.getUTCDay; weeks start on Monday (O-278). */
const SUNDAY = 0;
const DAYS_PER_WEEK = 7;
const MONDAY_OFFSET = 1;
const ISO_DATE_LENGTH = 10;
const FIRST_OF_MONTH = "01";
const MONTH_DIGITS = 2;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) {
    return cached;
  }
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatters.set(timeZone, created);
  return created;
}

function wallClockMs(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(instant).map((part) => [part.type, part.value]));
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
}

/** The zone's offset from UTC at an instant, in milliseconds (positive east of Greenwich). */
function offsetMs(instant: Date, timeZone: string): number {
  const whole = new Date(Math.floor(instant.getTime() / 1000) * 1000);
  return wallClockMs(whole, timeZone) - whole.getTime();
}

function requireIsoDate(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
    throw new RangeError(`${JSON.stringify(day)} is not an ISO date`);
  }
  return day;
}

function utcOf(day: string): Date {
  return new Date(`${requireIsoDate(day)}T00:00:00Z`);
}

function isoOf(utc: Date): string {
  return utc.toISOString().slice(0, ISO_DATE_LENGTH);
}

/** The local date of `instant` in `timeZone`. */
export function localDay(instant: Date, timeZone: string): string {
  return isoOf(new Date(wallClockMs(instant, timeZone)));
}

/** The instant local midnight starts `day` in `timeZone`. */
export function startOfDay(day: string, timeZone: string): Date {
  const wall = utcOf(day).getTime();
  const first = wall - offsetMs(new Date(wall), timeZone);
  return new Date(wall - offsetMs(new Date(first), timeZone));
}

/** `day` moved by `days` (negative goes back). */
export function addDays(day: string, days: number): string {
  return isoOf(new Date(utcOf(day).getTime() + days * MS_PER_DAY));
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcOf(to).getTime() - utcOf(from).getTime()) / MS_PER_DAY);
}

/** The Monday that starts the week of `day` (O-278). */
export function mondayOf(day: string): string {
  const weekday = utcOf(day).getUTCDay();
  const sinceMonday = (weekday - MONDAY_OFFSET + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  return addDays(day, weekday === SUNDAY ? -(DAYS_PER_WEEK - MONDAY_OFFSET) : -sinceMonday);
}

/** The first day of the month of `day` (O-276). */
export function monthOf(day: string): string {
  return `${requireIsoDate(day).slice(0, ISO_DATE_LENGTH - MONTH_DIGITS)}${FIRST_OF_MONTH}`;
}

/** The first day of the month after the month of `day`. */
export function nextMonth(day: string): string {
  const start = utcOf(monthOf(day));
  return isoOf(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)));
}

/** The first day of the month before the month of `day`. */
export function previousMonth(day: string): string {
  const start = utcOf(monthOf(day));
  return isoOf(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1)));
}

/** A database date column as an ISO date: pg answers `date` as a Date at local midnight of the process. */
export function isoDateOf(value: Date | string): string {
  if (typeof value === "string") {
    return requireIsoDate(value.slice(0, ISO_DATE_LENGTH));
  }
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(MONTH_DIGITS, "0");
  const date = String(value.getDate()).padStart(MONTH_DIGITS, "0");
  return `${year}-${month}-${date}`;
}
