// Tests for e2e/support/preview-server.ts (R3.13, O-264): the Playwright config starts the
// harness preview server only for the projects that drive it (mock, bench, shots), never for
// the stack project alone.
import { describe, expect, it } from "vitest";

import { needsPreviewServer, selectedProjects } from "../../e2e/support/preview-server.js";

const CLI = ["node", "playwright", "test"];

describe("R3.13 preview server switch", () => {
  it("R3.13 reads --project in both the joined and the separate form, repeated", () => {
    expect(selectedProjects([...CLI, "--project=mock"])).toEqual(["mock"]);
    expect(selectedProjects([...CLI, "--project", "bench", "--project=shots"])).toEqual(["bench", "shots"]);
    expect(selectedProjects([...CLI, "--grep", "R3.13"])).toEqual([]);
  });

  it("R3.13 the stack project alone never starts the preview server", () => {
    expect(needsPreviewServer([...CLI, "--project=stack"], {})).toBe(false);
    expect(needsPreviewServer([...CLI, "--project", "stack"], {})).toBe(false);
  });

  it("R3.13 mock, bench and shots start it, alone or mixed with stack", () => {
    for (const project of ["mock", "bench", "shots"]) {
      expect(needsPreviewServer([...CLI, `--project=${project}`], {})).toBe(true);
      expect(needsPreviewServer([...CLI, "--project=stack", `--project=${project}`], {})).toBe(true);
    }
  });

  it("R3.13 no --project runs every project, so the preview server starts", () => {
    expect(needsPreviewServer(CLI, {})).toBe(true);
  });

  it("R3.13 PW_PREVIEW=1 or 0 overrides what the arguments say", () => {
    expect(needsPreviewServer([...CLI, "--project=stack"], { PW_PREVIEW: "1" })).toBe(true);
    expect(needsPreviewServer([...CLI, "--project=mock"], { PW_PREVIEW: "0" })).toBe(false);
    expect(needsPreviewServer([...CLI, "--project=stack"], { PW_PREVIEW: "" })).toBe(false);
  });
});
