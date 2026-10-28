/**
 * The drill run screen's covered-part notes (S26, R3.14, O-312, PR #30 review MEDIUM 3 and 4):
 * - CoverageNote: a partly covered drill says how much it runs on and how much was queued;
 * - NoCoverageNote: a fully uncovered drill names the queued count read from the 422's typed
 *   pairs_total and pairs_queued members (never from the detail text);
 * - both link to /library through the router Link, so following the link is a client-side
 *   navigation that keeps the running session's page, never a full reload.
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApiProblem } from "../../src/api/index.js";
import { fixtureFullCoverage, fixturePartCoverage } from "../../src/fixtures/trainer.js";
import { CoverageNote, NoCoverageNote } from "../../src/routes/drill-run/CoverageNote.js";
import { sessionProblemFromBody } from "../../src/trainer/session-problem.js";
import { problemOf } from "../../src/trainer/spot-problem.js";
import { LIBRARY_MARKER_ID, renderInRouter } from "./screen-router.js";

const NO_COVERAGE_BODY = {
  type: "urn:g-tee-oh:problem:no-coverage",
  title: "No coverage",
  status: 422,
  detail: "This drill cannot be dealt: the library covers none of this drill's spots.",
} as const;

describe("R3.14 covered-part note", () => {
  it("R3.14 a partly covered drill says how much it runs on and how much was queued, with a link to the library (O-312)", async () => {
    await renderInRouter(<CoverageNote coverage={fixturePartCoverage} />);
    const note = screen.getByTestId("coverage-note");
    expect(note).toHaveTextContent("Running on 2 of 3 spots; 1 queued for the builder");
    expect(within(note).getByRole("link", { name: /library/ })).toHaveAttribute("href", "/library");
  });

  it("R3.14 a fully covered drill or a session without coverage shows no note", async () => {
    await renderInRouter(
      <>
        <CoverageNote coverage={fixtureFullCoverage} />
        <CoverageNote coverage={undefined} />
      </>,
    );
    expect(screen.queryByTestId("coverage-note")).not.toBeInTheDocument();
  });
});

describe("R3.14 review MEDIUM 4: the library link is a client-side navigation", () => {
  it.each([
    ["the covered-part note", <CoverageNote key="part" coverage={fixturePartCoverage} />],
    ["the no-coverage note", <NoCoverageNote key="none" problem={{ kind: "no_coverage", status: 422 }} />],
  ])("R3.14 following %s's link moves the router to /library without a page load", async (_name, note) => {
    const { router } = await renderInRouter(note);
    const link = screen.getByRole("link", { name: "Open the library" });
    // fireEvent returns false when a handler called preventDefault: the router took the click,
    // so the browser does not load /library as a new page (which would drop the session).
    expect(fireEvent.click(link)).toBe(false);
    expect(await screen.findByTestId(LIBRARY_MARKER_ID)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/library");
  });
});

describe("R3.14 review MEDIUM 3: the no-coverage counts are typed members of the 422", () => {
  it("R3.14 a fully uncovered drill names the queued count from the 422's pairs_total and pairs_queued and links to the library", async () => {
    const problem = problemOf(sessionProblemFromBody(422, { ...NO_COVERAGE_BODY, pairs_total: 3, pairs_queued: 2 }));
    expect(problem).toEqual({ kind: "no_coverage", status: 422, queued: { queued: 2, total: 3 } });
    await renderInRouter(<NoCoverageNote problem={problem} />);
    const note = screen.getByTestId("no-coverage-note");
    expect(note).toHaveTextContent("2 of this drill's 3 spots were queued for the builder");
    expect(within(note).getByRole("link", { name: /library/ })).toHaveAttribute("href", "/library");
  });

  it("R3.14 the detail text is never read: counts written only in the detail give no count", () => {
    const detail = `${NO_COVERAGE_BODY.detail} 3 of its 3 spots were queued for the builder.`;
    expect(problemOf(sessionProblemFromBody(422, { ...NO_COVERAGE_BODY, detail }))).toEqual({ kind: "no_coverage", status: 422 });
    expect(problemOf(new ApiProblem({ status: 422, slug: "no-coverage", title: "t", detail }))).toEqual({ kind: "no_coverage", status: 422 });
  });

  it.each([
    [{ pairs_total: -1, pairs_queued: 0 }],
    [{ pairs_total: 3, pairs_queued: "2" }],
    [{ pairs_total: 2.5, pairs_queued: 1 }],
    [{ pairs_total: 3 }],
    [{ pairs_total: 2, pairs_queued: 3 }],
  ])("R3.14 malformed counts %j are dropped, never shown", (counts) => {
    expect(problemOf(sessionProblemFromBody(422, { ...NO_COVERAGE_BODY, ...counts }))).toEqual({ kind: "no_coverage", status: 422 });
  });

  it("R3.14 counts on another problem, or a body that is not a problem, are ignored", () => {
    const stale = sessionProblemFromBody(409, { type: "urn:g-tee-oh:problem:stale-state", title: "t", status: 409, pairs_total: 3, pairs_queued: 3 });
    expect(problemOf(stale)).toEqual({ kind: "stale", status: 409 });
    expect(problemOf(sessionProblemFromBody(422, null))).toEqual({ kind: "other", status: 422, slug: "unknown" });
  });

  it("R3.14 a 422 without counts still links to the library, and other problems show nothing", async () => {
    const problem = problemOf(new ApiProblem({ status: 422, slug: "no-coverage", title: "t", detail: "something else" }));
    expect(problem).toEqual({ kind: "no_coverage", status: 422 });
    const { rerender } = await renderInRouter(<NoCoverageNote problem={problem} />);
    expect(screen.getByTestId("no-coverage-note")).not.toHaveTextContent("were queued");
    expect(screen.getByRole("link", { name: /library/ })).toBeInTheDocument();
    rerender(<NoCoverageNote problem={{ kind: "network", status: null }} />);
    expect(screen.queryByTestId("no-coverage-note")).not.toBeInTheDocument();
  });
});
