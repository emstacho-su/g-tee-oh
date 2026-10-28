# Drill acceptance sets

This directory holds the synthetic drill set, `synthetic-drill-set.json`, the default input of the drill acceptance runner (requirement R3.15, open question identifier (O-ID) O-315). The runner checks that every drill of an acceptance file is expressed in the drill schema and runs: it parses with the api's DrillCreate schema, and over the api and a library, POST /drills, POST /sessions in drill mode and GET /sessions/{id}/next produce a trainer prompt with at least one button.

## Running it

    just drill-acceptance validation/fixtures/drills/synthetic-drill-set.json
    just drill-acceptance C:/path/to/another-acceptance-file.json

FILE is absolute or relative to the repository root. The recipe sets DRILL_ACCEPTANCE_FILE and runs `services/api/test/acceptance/drill-acceptance.test.ts`, which builds the api over the vitest Postgres test container and the fixture solver-query: the real solver-query binary over `validation/fixtures/library`, or the instance SOLVER_QUERY_URL names (O-244). Docker must be running. Each case is one test named "R3.15 <case name>"; a failing case names the step, the api's status and its problem detail, never a strategy number. Without DRILL_ACCEPTANCE_FILE the runner reads this directory's set, so `just ts-test` and CI run it on every change until the owner's build card is exported (O-24, O-64).

## The file format, version 1

| Field | Type | Meaning |
|---|---|---|
| `version` | integer | Always 1. |
| `source` | string | Where the drills come from: `synthetic`, the owner's build card, or the 05 section 4 fallback under O-67. |
| `library_note` | string | The library the file is meant to run against. |
| `cases` | array, 1 to 64 | One case per drill, names unique. |
| `cases[].name` | string | The case name the test is named after. |
| `cases[].drill` | object | A DrillCreate body: `name`, `tags`, `spot_filter`, `trainer` (services/api/src/schemas/drills.ts). |
| `cases[].note` | string, optional | Why the case looks the way it does. |

Every object is strict, so an unknown key fails the load. The loader (`services/api/test/acceptance/acceptance-file.ts`) checks the envelope; each drill is expressed on its own, so a drill that does not parse fails its own case only.

## The synthetic set

Every drill is made up for testing over the synthetic fixture library and uses g-tee-oh field names only (O-26, ADR 0017). It covers the four fallback drills of 05 section 4 (O-67) and more families the fixture library can serve:

| Case | Configuration | What it exercises |
|---|---|---|
| RFI boundary hands, BTN | online 6-max 100 bb | raise first in at BTN, close decisions; the drill flow 2 builds |
| RFI boundary hands, every opening seat | online 6-max 100 bb | raise first in at UTG, HJ, CO, BTN and SB, close decisions |
| BB vs BTN mixed region | online 6-max 100 bb | BB facing a BTN open, close decisions |
| BB vs CO mixed region | online 6-max 100 bb | BB facing a CO open, close decisions |
| Live-depth opens, 1/3 | live 9-handed 1/3 100 bb | raise first in at every opening seat, all hands |
| Live-depth opens, 2/5 | live 9-handed 2/5 100 bb | the same at 2/5 |
| BTN vs three-bet from the blinds | online 6-max 100 bb | BTN facing a three-bet from SB or BB, every-action pause |
| Street mode, BB vs BTN at 150 bb | online 6-max 150 bb | end-of-street stop rule |
| Full hand, CO opens at 200 bb | online 6-max 200 bb | end-of-hand stop rule, RNG mode, quick result |
| Live 2/5 blind versus blind, alternating seats | live 9-handed 2/5 100 bb | SB and BB alternating, raise first in or facing the open |
| Manual boundary list, HJ opens at three depths | online 6-max 100, 150, 200 bb | a manual hand list, a timebank, two panels |
| CO three-bets the HJ open | online 6-max 100 bb | the three-bet family, close decisions |

The fixture library holds live configurations at 100 bb only, so the live cases stop there (O-316); deeper live depths wait for the build card and the reference library (S29). A drill names one stake, so live-depth opens is one case per stake.

## The build card

The owner's 15-drill build card (O-24) is not exported yet. Until it is, the acceptance file of record is the vault's `research/2026-10-28-s26-build-card-acceptance-fallback.json`, the four drills of 05 section 4 (O-67), run against the fixture library; no packed reference configurations exist (S10, R1.7), so no reference-library run has been made. When the card arrives, its file goes through the same runner with `just drill-acceptance FILE`.
