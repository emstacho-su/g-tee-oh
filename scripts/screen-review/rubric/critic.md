# How the critic runs

Two passes per screen family, each an agent with the Read tool (it can open PNG files), and a merge script that turns their JSON into verdicts, a digest and database rows for the review page.

## Inputs

- `<shots>/manifest.json` written by `just shots`: one record per picture with `screen`, `theme`, `width`, `file`, `criterion`, `source`.
- `rubric/families.json`: which family and lane a screen belongs to and which R rules apply.
- `rubric/rules.md`: the checks.
- The owner's earlier verdicts and notes (private, outside the repo): the analyst treats a note on the same screen as a must.

## Pass 1: analyst (one agent per family)

For every screen in the family: read all four pictures, the criterion, the family's rules and the owner's earlier note if any. Decide `yes` (no check fails) or `no`, and write one record:

```json
{
  "screen": "study-ev",
  "verdict": "no",
  "confidence": "high",
  "reasons": [
    { "rule": "R2", "text": "The lens is not named in the heading; the user cannot tell EV from frequency without the legend.", "variants": ["dark-1440", "light-1440"] }
  ],
  "work_items": [6],
  "fix_hint": "Name the lens in the node heading next to the matrix mode toggle."
}
```

`rule` is a G or R id from rules.md or `OWNER` for an earlier note that is still unmet; `variants` lists the pictures where it shows (`theme-width`); `work_items` are the comparison's ranked item numbers the fix belongs to, when any. A `yes` has an empty `reasons` list. The family file is `<critic>/analyst/<family>.json`:

```json
{ "family": "study", "lane": "S45", "screens": [ ...records... ] }
```

Rules for the analyst: judge what is visible, not what the code might do; one reason per failing check, not one per variant; prefer "no" with a specific reason to a vague "yes"; never flag the items under "What not to flag".

## Pass 2: verifier (one agent per family)

Reads the analyst file and, for every `no`, re-reads the pictures and the component source under `web/src` to check the reason is real on the merged head (not a stale picture, not a mock artefact, not a check the criterion overrides). Writes `<critic>/verifier/<family>.json`:

```json
{ "family": "study", "checks": [ { "screen": "study-ev", "upheld": true, "note": "NodeView.tsx renders the mode toggle but no heading text names the lens." } ] }
```

`upheld: false` turns the screen into `yes` with the note kept. A verifier may also add a note to an upheld `no` that corrects the layer (web, api, solver-query) the fix belongs in.

## Merge

```
node scripts/screen-review/merge-auto-verdicts.mjs --manifest <shots>/manifest.json --analyst <critic>/analyst --verifier <critic>/verifier --out <shots>
```

Writes `<shots>/auto-verdicts.json` (one record per screen with the final verdict, beside the manifest so `just shots-review` finds it), `<shots>/digest.md` (per-lane tables with a tally) and `<shots>/db/<screen>.json` (one document per screen for the review page's `auto_verdicts` collection, uploaded in batches of fifty with the artifact database tool). Every manifest screen must have an analyst record, or the merge fails and names the missing ones.

## Page

```
node scripts/screen-review/build-page.mjs --manifest <shots>/manifest.json --out <shots>/page --auto <shots>/auto-verdicts.json --round 3 [--previous-verdicts <dir>] [--previous-index <index.html>]
```

The page shows each screen's four pictures, its criterion, the earlier verdict, the critic's verdict with reasons, and the owner's Yes and No. "Agree with the critic" copies the critic's verdict into the owner's `verdicts` collection. The `just shots-review` recipe runs this with the defaults.
