// License policy for pnpm dependencies (R0.2, ADR 0002).
//
// Mechanism: pnpm reports each installed package under the license id its package.json declares.
// This module decides, per id, whether the repo may ship that package. The repo is MIT and bundles
// an MIT engine, so any GPL (GNU General Public License) or AGPL (GNU Affero General Public License)
// family id is forbidden, while the LGPL (GNU Lesser General Public License) is allowed because
// linking to an LGPL library does not relicense the caller. Ids that carry no machine-readable
// license are reported as unknown so a human looks, but they do not fail the build.
//
// scripts/check-licenses.mjs does the I/O (input/output); everything here is pure so
// scripts/license-policy.test.mjs can cover it with fixture ids.

// "A?GPL" not preceded by a letter rejects LGPL and LGPLv3 while catching GPL, AGPL, GPL-2.0,
// GPL-3.0-or-later, GPLv2 and compound expressions such as "(MIT OR GPL-2.0)".
export const FORBIDDEN_LICENSE_PATTERN = /(?<![A-Za-z])A?GPL(?=$|[^A-Za-z]|v\d)/i;

// Ids pnpm emits when a package declares no usable license field.
export const UNKNOWN_LICENSE_PATTERN = /^(UNKNOWN|UNLICENSED|SEE LICENSE IN .+)$/i;

export const LICENSE_VERDICT = Object.freeze({
  ALLOWED: "allowed",
  FORBIDDEN: "forbidden",
  UNKNOWN: "unknown",
});

/**
 * True when the license id belongs to the GPL or AGPL family.
 * @param {unknown} licenseId
 * @returns {boolean}
 */
export function licenseIsForbidden(licenseId) {
  return typeof licenseId === "string" && FORBIDDEN_LICENSE_PATTERN.test(licenseId.trim());
}

/**
 * True when the id says nothing about the license (missing, placeholder, or a pointer to a file).
 * @param {unknown} licenseId
 * @returns {boolean}
 */
export function licenseIsUnknown(licenseId) {
  if (typeof licenseId !== "string") {
    return true;
  }
  const trimmed = licenseId.trim();
  return trimmed === "" || UNKNOWN_LICENSE_PATTERN.test(trimmed);
}

/**
 * Classify one license id. Forbidden wins over unknown so a compound id that names a GPL
 * alternative is still rejected.
 * @param {unknown} licenseId
 * @returns {"allowed" | "forbidden" | "unknown"}
 */
export function classifyLicense(licenseId) {
  if (licenseIsForbidden(licenseId)) {
    return LICENSE_VERDICT.FORBIDDEN;
  }
  if (licenseIsUnknown(licenseId)) {
    return LICENSE_VERDICT.UNKNOWN;
  }
  return LICENSE_VERDICT.ALLOWED;
}

/**
 * @typedef {{ name?: string, versions?: string[] }} ReportedPackage
 * @typedef {{ licenseId: string, name: string, versions: string[] }} Finding
 * @typedef {{ packageCount: number, licenseCount: number, forbidden: Finding[], unknown: Finding[] }} Evaluation
 */

/**
 * Evaluate the parsed output of "pnpm licenses list --json": an object keyed by license id whose
 * values are arrays of packages. Returns new arrays and never mutates the report.
 * @param {Record<string, ReportedPackage[]>} report
 * @returns {Evaluation}
 */
export function evaluateLicenseReport(report) {
  const entries = Object.entries(report);
  const findingsFor = (verdict) =>
    entries
      .filter(([licenseId]) => classifyLicense(licenseId) === verdict)
      .flatMap(([licenseId, packages]) => packages.map((pkg) => describePackage(licenseId, pkg)));
  return {
    packageCount: entries.reduce((count, [, packages]) => count + packages.length, 0),
    licenseCount: entries.length,
    forbidden: findingsFor(LICENSE_VERDICT.FORBIDDEN),
    unknown: findingsFor(LICENSE_VERDICT.UNKNOWN),
  };
}

/**
 * @param {string} licenseId
 * @param {ReportedPackage} pkg
 * @returns {Finding}
 */
function describePackage(licenseId, pkg) {
  return {
    licenseId,
    name: typeof pkg.name === "string" && pkg.name !== "" ? pkg.name : "(unnamed package)",
    versions: Array.isArray(pkg.versions) ? [...pkg.versions] : [],
  };
}
