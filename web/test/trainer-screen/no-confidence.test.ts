/**
 * The retired confidence tap stays retired (S37, R3.13, O-345, O-373): the api answers a decision
 * body that carries confidence with a 400, so no trainer source may name the field or the tap. The
 * decision body is also typed against the contract (session-api.ts), which no longer has the field,
 * and the screen tests assert the exact body; this scan catches a stray use anywhere else in the
 * trainer, including a test helper that would hide the field from the typed path.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** The web package is the test run's working directory, as in test/cosmetics/catalog.test.ts. */
const SOURCE_ROOT = join(process.cwd(), "src");
/** Every directory whose code plays a decision; drift's statistical "confidence" lives elsewhere. */
const TRAINER_DIRECTORIES = ["trainer", "routes/drill-run", "routes/train", "components/trainer", "routes/settings"];
/** The field as a property or key, and every name the tap had; a comment may still say it was retired. */
const RETIRED = /\bconfidence\??\s*:|["']confidence["']|ConfidenceTap|ConfidenceChoice|CONFIDENCE_SCOPE|await_confidence|tapConfidence|SURE_KEY|UNSURE_KEY/;

function sourcesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourcesUnder(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("R3.13 the confidence tap is gone from the trainer (O-345, O-373)", () => {
  it("R3.13 no trainer source names the retired confidence field, the tap or its keys", () => {
    const files = TRAINER_DIRECTORIES.flatMap((directory) => sourcesUnder(join(SOURCE_ROOT, directory)));
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.filter((file) => RETIRED.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
