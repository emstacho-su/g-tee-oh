// Tests for the pnpm license policy (R0.2, ADR 0002). Run with: pnpm run test:scripts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LICENSE_VERDICT,
  classifyLicense,
  evaluateLicenseReport,
  licenseIsForbidden,
  licenseIsUnknown,
} from "./license-policy.mjs";

const FORBIDDEN_IDS = [
  "AGPL-3.0-only",
  "AGPL-3.0",
  "GPL-2.0-or-later",
  "GPL-2.0",
  "GPL-3.0",
  "GPL-3.0-or-later",
  "GPL",
  "GPLv2",
  "gpl-3.0",
  "(MIT OR GPL-2.0)",
  "GPL-2.0-with-classpath-exception",
];

const ALLOWED_IDS = [
  "LGPL-2.1",
  "LGPL-2.1-or-later",
  "LGPL-3.0",
  "LGPLv3",
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MPL-2.0",
  "0BSD",
  "CC0-1.0",
  "Unlicense",
  "(MIT OR Apache-2.0)",
];

const UNKNOWN_IDS = ["UNKNOWN", "Unknown", "UNLICENSED", "SEE LICENSE IN LICENSE.md", "", "   "];

describe("license policy", () => {
  it("R0.2 licenseIsForbidden rejects every GPL and AGPL family id", () => {
    for (const id of FORBIDDEN_IDS) {
      assert.equal(licenseIsForbidden(id), true, `${id} must be forbidden`);
    }
  });

  it("R0.2 licenseIsForbidden allows LGPL and permissive ids", () => {
    for (const id of ALLOWED_IDS) {
      assert.equal(licenseIsForbidden(id), false, `${id} must be allowed`);
    }
  });

  it("R0.2 licenseIsForbidden treats non-string ids as not forbidden", () => {
    for (const id of [undefined, null, 42, {}]) {
      assert.equal(licenseIsForbidden(id), false);
    }
  });

  it("R0.2 licenseIsUnknown flags placeholders, blanks and non-strings", () => {
    for (const id of UNKNOWN_IDS) {
      assert.equal(licenseIsUnknown(id), true, `${JSON.stringify(id)} must be unknown`);
    }
    assert.equal(licenseIsUnknown(undefined), true);
    assert.equal(licenseIsUnknown("MIT"), false);
  });

  it("R0.2 classifyLicense returns forbidden, unknown or allowed", () => {
    assert.equal(classifyLicense("AGPL-3.0-only"), LICENSE_VERDICT.FORBIDDEN);
    assert.equal(classifyLicense("GPL-2.0-or-later"), LICENSE_VERDICT.FORBIDDEN);
    assert.equal(classifyLicense("LGPL-2.1"), LICENSE_VERDICT.ALLOWED);
    assert.equal(classifyLicense("MIT"), LICENSE_VERDICT.ALLOWED);
    assert.equal(classifyLicense("UNKNOWN"), LICENSE_VERDICT.UNKNOWN);
    assert.equal(classifyLicense("UNLICENSED"), LICENSE_VERDICT.UNKNOWN);
  });
});

describe("license report evaluation", () => {
  const report = Object.freeze({
    MIT: [
      { name: "left-pad", versions: ["1.3.0"] },
      { name: "chalk", versions: ["4.1.2", "5.3.0"] },
    ],
    "AGPL-3.0-only": [{ name: "copyleft-db", versions: ["2.0.0"] }],
    "GPL-2.0-or-later": [{ name: "gnu-thing", versions: ["0.1.0"] }],
    "LGPL-2.1": [{ name: "lesser-lib", versions: ["1.0.0"] }],
    UNKNOWN: [{ name: "mystery" }],
  });

  it("R0.2 evaluateLicenseReport lists forbidden packages with their license id and versions", () => {
    const evaluation = evaluateLicenseReport(report);
    assert.deepEqual(evaluation.forbidden, [
      { licenseId: "AGPL-3.0-only", name: "copyleft-db", versions: ["2.0.0"] },
      { licenseId: "GPL-2.0-or-later", name: "gnu-thing", versions: ["0.1.0"] },
    ]);
  });

  it("R0.2 evaluateLicenseReport separates unknown ids from forbidden ones", () => {
    const evaluation = evaluateLicenseReport(report);
    assert.deepEqual(evaluation.unknown, [{ licenseId: "UNKNOWN", name: "mystery", versions: [] }]);
  });

  it("R0.2 evaluateLicenseReport counts packages and license ids", () => {
    const evaluation = evaluateLicenseReport(report);
    assert.equal(evaluation.packageCount, 6);
    assert.equal(evaluation.licenseCount, 5);
  });

  it("R0.2 evaluateLicenseReport passes a clean report with no findings", () => {
    const evaluation = evaluateLicenseReport({ MIT: [{ name: "a", versions: ["1.0.0"] }] });
    assert.deepEqual(evaluation.forbidden, []);
    assert.deepEqual(evaluation.unknown, []);
    assert.equal(evaluation.packageCount, 1);
  });

  it("R0.2 evaluateLicenseReport handles an empty report", () => {
    const evaluation = evaluateLicenseReport({});
    assert.equal(evaluation.packageCount, 0);
    assert.equal(evaluation.licenseCount, 0);
  });
});
