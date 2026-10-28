/**
 * Display text for the builder health panel (S28, R3.5, O-299). Bytes print in decimal units
 * (1 GB = 10^9 bytes, as the 650 GB budget of ADR 0018 is written); a share prints as a percent.
 */
const UNITS: readonly { readonly size: number; readonly name: string }[] = [
  { size: 1e12, name: "TB" },
  { size: 1e9, name: "GB" },
  { size: 1e6, name: "MB" },
  { size: 1e3, name: "kB" },
];
const HOURS_PER_DAY = 24;
const PERCENT = 100;

export function formatBytes(bytes: number): string {
  const unit = UNITS.find((candidate) => bytes >= candidate.size);
  if (unit === undefined) return `${bytes} B`;
  return `${(bytes / unit.size).toFixed(1)} ${unit.name}`;
}

export function formatPercent(share: number): string {
  return `${(share * PERCENT).toFixed(1)}%`;
}

/** Builds per day from the api's builds per hour over the last day; one build is one flop. */
export function flopsPerDay(throughputPerHour: number): number {
  return Math.round(throughputPerHour * HOURS_PER_DAY);
}

/** Two digits, so 7 reads 07:00. */
export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}
