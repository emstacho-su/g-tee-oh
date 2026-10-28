// Router-level search validation (S25, R3.12, R3.13, O-286, O-288). The router merges a parent's
// raw search into a child's, so a key the screen route's validator dropped is still in
// useSearch(); these tests render the real route tree with the two screens replaced by probes
// and check that a malformed or unknown key never reaches StudyPage or DrillRunPage.
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderApp, SIGNED_IN } from "./app/render-app.js";

const received = vi.hoisted(() => ({ study: [] as unknown[], drillRun: [] as unknown[] }));

vi.mock("../src/routes/study/StudyPage.js", () => ({
  StudyPage: (props: unknown) => {
    received.study.push(props);
    return <p>study probe</p>;
  },
}));

vi.mock("../src/routes/drill-run/DrillRunPage.js", () => ({
  DrillRunPage: (props: unknown) => {
    received.drillRun.push(props);
    return <p>drill run probe</p>;
  },
}));

async function propsAt(path: string, probe: "study" | "drillRun"): Promise<unknown> {
  renderApp(path, SIGNED_IN);
  await screen.findByText(probe === "study" ? "study probe" : "drill run probe");
  return received[probe].at(-1);
}

beforeEach(() => {
  received.study = [];
  received.drillRun = [];
});

describe("R3.13 screens receive only validated search parameters", () => {
  it("R3.13 a malformed seed and unknown keys never reach the drill session screen (O-288)", async () => {
    expect(await propsAt("/drills/abc/run?seed=XYZ&admin=1", "drillRun")).toEqual({ drillId: "abc" });
  });

  it("R3.13 a valid seed reaches the drill session screen", async () => {
    expect(await propsAt("/drills/abc/run?seed=0123456789abcdef", "drillRun")).toEqual({
      drillId: "abc",
      seed: "0123456789abcdef",
    });
  });

  it("R3.12 malformed and unknown keys never reach the study screen, valid ones do (O-286)", async () => {
    const props = await propsAt(
      "/study?format=online&table_size=6&pair=BB-BTN&line=r250&mode=ev&hand=AKs&depth=nope&extra=x&note=%3Cscript%3E",
      "study",
    );
    expect(props).toEqual({
      search: { format: "online", table_size: 6, pair: "BB-BTN", line: "r250", mode: "ev", hand: "AKs" },
    });
  });

  it("R3.12 a malformed line, hand and mode are dropped", async () => {
    expect(await propsAt("/study?line=R250..x&hand=AKx&mode=matrix", "study")).toEqual({ search: {} });
  });
});
