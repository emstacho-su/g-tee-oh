/**
 * Tests for a reopen that fails (S45 code review 2, R3.27): when the navigation to the browser's last
 * spot is rejected, the page shows the empty settings panel with a sentence saying so, never the
 * "Opening your last spot." note forever. The router's useNavigate is wrapped (as stable as the real
 * one) so the first replace to /study rejects; every other navigation goes through.
 */
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FIXTURE_ONLINE_STAKE_ID, FIXTURE_STUDY_PAIR } from "../../src/fixtures/study.js";
import { useStudySpotsStore } from "../../src/store/study-spots.js";
import { renderStudy } from "./render-study.js";

const failure = vi.hoisted(() => ({ rejectNextReplace: false }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const react = await import("react");
  return {
    ...actual,
    useNavigate: () => {
      const navigate = actual.useNavigate();
      return react.useCallback(
        (options: Parameters<typeof navigate>[0]) => {
          if (failure.rejectNextReplace && options.replace === true) {
            failure.rejectNextReplace = false;
            return Promise.reject(new Error("navigation blocked"));
          }
          return navigate(options);
        },
        [navigate],
      ) as typeof navigate;
    },
  };
});

const SPOT = { format: "online", table_size: 6, stake: FIXTURE_ONLINE_STAKE_ID, depth: 10000, pair: FIXTURE_STUDY_PAIR } as const;

let spies: { mockRestore: () => void }[] = [];

beforeEach(() => {
  spies = [
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null),
    vi.spyOn(console, "error").mockImplementation(() => undefined),
  ];
});

afterEach(() => {
  spies.forEach((spy) => spy.mockRestore());
  failure.rejectNextReplace = false;
});

describe("R3.27 a reopen that fails", () => {
  it("R3.27 a rejected navigation shows the empty panel with a sentence, never the stuck note (code review 2)", async () => {
    useStudySpotsStore.getState().recordConfirmed(SPOT);
    failure.rejectNextReplace = true;
    renderStudy("/study");
    expect(await screen.findByRole("region", { name: "Spot settings" })).toBeInTheDocument();
    expect(screen.getByText("Your last spot could not be opened. Choose the settings below.")).toBeInTheDocument();
    expect(screen.queryByText("Opening your last spot.")).not.toBeInTheDocument();
  });
});
