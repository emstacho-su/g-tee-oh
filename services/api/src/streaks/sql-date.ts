/**
 * An ISO date (YYYY-MM-DD, a local day in APP_TIME_ZONE) as a SQL date parameter (R4.13, R4.14):
 * cast in the database, so the comparison is calendar-exact and never shifted by the process's
 * own time zone, as a JavaScript Date would be.
 */
import { sql, type RawBuilder } from "kysely";

export function sqlDate(day: string): RawBuilder<Date> {
  return sql<Date>`cast(${day} as date)`;
}
