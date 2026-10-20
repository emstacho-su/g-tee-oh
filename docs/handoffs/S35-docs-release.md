---
id: 'g-tee-oh-handoff-s35-docs-release'
title: 'S35 Docs and release'
collection: 'g-tee-oh'
type: handoff
status: 'ready'
created: 2026-10-19
public: true
phase: 4
session: 'S35'
branch: 'p4/docs-release'
tags: [g-tee-oh, handoff, phase-4]
---
# S35 Docs and release (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-4-rating-and-release|Phase 4 Rating, scheduling, progress, Deploy 2 and the v1 gate]]. This session refreshes the docs mirror (O-45), reviews `docs/security.md`, writes the README, generates the software bill of materials (SBOM), tags the release so the `images` job pushes multi-arch images, and then merges `sprint/1-v1` into `main`. It closes R4.18 and ends sprint 1. Branch `p4/docs-release` off `sprint/1-v1`; parallel group G, earliest day 15 (2026-11-03), after S34; paced for week 5 after the v1 gate on day 31 (09 sections 4 and 5); single session; public; low usage (1 unit). Decisions are cited as ADR nnnn (architecture decision record); answered questions by O-ID from [[projects/g-tee-oh/planning/00-open-questions-and-risks|00 Open questions and risks]].

## Before pasting

- [ ] S34 merged into `sprint/1-v1`: `validation/reports/v1-gate.md` present with the committed `just v1-gate` output, every criterion passing (09 section 3: S34 blocks S35).
- [ ] `sprint/1-v1` green on all seven continuous integration (CI) jobs at its head.
- [ ] The `public: true` file list from Step 3 at hand (the frontmatter flags on the phase docs, the public handoffs and 09; `planning/10-traceability.md` if the verifier wrote it) (O-26, O-45).
- [ ] CI secrets let the `images` job push to the GitHub Container Registry on a tag (R0.3), and the owner can create a tag and approve a pull request into the protected `main`.
- [ ] Machine: the Zenbook, clone `C:\Users\stack\projects\g-tee-oh`, PowerShell (O-23).

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull --ff-only
git switch -c p4/docs-release
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault, copy the flagged files, and append O-IDs to `planning/00-open-questions-and-risks.md`.
2. Stay in the default permission mode.
3. Paste the prompt below.

## The prompt

```text
You are running session S35 of sprint 1 of g-tee-oh, Phase 4 (rating, scheduling, progress, Deploy 2 and the v1 gate), on branch p4/docs-release off the sprint branch sprint/1-v1. Goal: the release, closing R4.18: docs mirror refreshed, docs/security.md reviewed, README written, SBOM generated, release tagged with multi-arch images pushed, sprint/1-v1 merged into main.

Reading order (vault root C:\Users\stack\vault\projects\g-tee-oh, added with /add-dir; paths are relative to it):
1. planning/phases/phase-4-rating-and-release.md
2. planning/09-v1-sprint-roadmap.md sections 1, 5 (row S35), 6 (Phase 4) and 7
3. planning/00-open-questions-and-risks.md, answered questions O-17 to O-67; O-26, O-29, O-45 and O-58 bind this session
4. planning/architecture/A9-quality-security-ops.md sections 2 and 3; A1-repo-and-conventions.md sections 1, 4 and 5
5. decisions/0017-planning-docs-live-in-the-private.md, 0021-gto-wizard-capture-through-a-claude.md (the privacy boundary), 0002-engine-base-is-ucsandman-postflop-mit.md (license notices)
6. planning/10-traceability.md if it exists; every vault file whose frontmatter says public: true
7. The repo's CLAUDE.md, docs/ as S01 mirrored it (R0.12), docs/security.md, validation/reports/v1-gate.md

Rules:
- Zenbook clone C:\Users\stack\projects\g-tee-oh, Claude Code in PowerShell (O-23). The private capture repo is not touched.
- Branch p4/docs-release; merge by pull request into sprint/1-v1; then, and only in this session, sprint/1-v1 merges into main by a pull request the owner approves (R4.18, A1 section 4).
- Gates in order: plan first in plan mode and wait for approval; a task list; tests green (the guard, the provenance test, the licenses job), never advance on red; /code-review; /security-review on docs/security.md and the release configuration; conventional commits (docs:, chore:, ci:), each ending with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Accepted ADRs are fixed; cite O-IDs; anything open becomes a proposed O-ID with a default appended to planning/00 under a new dated subsection.
- Privacy (O-26, O-45): mirror only files flagged public: true; read each one in full before copying; a specific (route, payload shape, game type code, drill parameter name, capture method, tier, volume, screenshot, session mechanics, tool name) stops the mirror of that file and is reported. The guard runs on docs/ and must pass (O-58).
- Writing style for README and docs: no em dashes, no bold, acronyms expanded on first use, mechanism before conclusion; plain links inside the repo, wikilinks only in the vault.
- Report honestly at every gate.

Inputs:
- The flagged vault files: the phase docs, the public handoffs, planning/09, the ADRs (never edited, A1 section 4), any ADR amendment from S33, planning/10-traceability.md if present.
- validation/reports/v1-gate.md and the reports it links; the Deploy 2 report; the existing docs/ mirror and docs/security.md stub (R0.12); the A9 section 3 control table for the security review.
- The images job (multi-arch buildx, push on tags only, R0.3) and the licenses job (cargo-deny, pnpm license check, R0.2).

Requirements this session closes (gate artifact in parentheses):
- R4.18 release: docs mirror refreshed (O-45), docs/security.md reviewed, README, SBOM per release (A9 section 3), tagged release with multi-arch images pushed, sprint/1-v1 merged to main (images job green on the tag; SBOM artifact attached; docs provenance test green).

Steps, every one single:
1. (single) Plan mode: read; list the files to mirror with their provenance, the README outline, the SBOM method and the tag; wait for approval; task list.
2. (single) Docs mirror (O-45, R0.12): copy each flagged file into docs/ with its public: true provenance, converting wikilinks to plain relative links; run the guard on docs/ and the provenance test; stop on any specific.
3. (single) Review docs/security.md against A9 section 3 and the deployed state (Caddy and transport, cookies and auth, roles and bucket credentials, secrets handling, container hardening, backups, the guard, no telemetry); update what changed; add the review date and the sprint gate it covers.
4. (single) README: what v1 is (09 section 1), how to run the dev and mac profiles (A1 section 6), the gates and where the reports live, the privacy rule in one paragraph (naming GTO Wizard as the product emulated is allowed; nothing from it is in the repo), the license and the vendored engine notice (ADR 0002).
5. (single) SBOM (A9 section 3): generate one for the Cargo workspace and one for the pnpm workspace with the tool the repo already carries; if none exists, the format and tool are open (see problems list) and you propose one in the pull request; keep the generation command in the justfile so every later release repeats it.
6. (single) /code-review and /security-review; commit; open the pull request into sprint/1-v1; after the owner merges it, create the release tag on the sprint head (tag name open, see problems list); confirm the images job builds amd64 and arm64 and pushes on the tag; attach the SBOM files to the GitHub release.
7. (single) Open the pull request from sprint/1-v1 into main with the v1 gate report linked and the R IDs R0.1 to R4.18 summarized by phase; the owner approves and merges (main is protected); confirm main is green on all seven jobs.

Definition of done:
- [ ] docs/ holds only public: true files with provenance; the guard and the provenance test are green; docs/security.md carries this gate's review.
- [ ] README current; SBOM files generated and attached to the release; the generation command in the justfile.
- [ ] Tag created; images job green on it with amd64 and arm64 pushed; licenses job green.
- [ ] /code-review and /security-review done; the p4/docs-release pull request merged into sprint/1-v1.
- [ ] sprint/1-v1 merged into main by the owner's approved pull request; main green.

Report back, in the final message: R4.18 with each check (guard, provenance test, images job, licenses job) and its result; both pull request links and the tag; the files written and the files mirrored; the SBOM artifact location; usage in units against the planned low (1); any new question as a proposed O-ID with a default, appended to planning/00 under a new dated subsection.
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| Refreshed docs mirror of every `public: true` file, with provenance | `docs/` on `p4/docs-release` |
| Reviewed threat model | `docs/security.md` |
| README | repo root |
| SBOM for the Cargo and pnpm workspaces, plus its justfile target | release assets on GitHub; the command in `justfile` |
| Release tag with amd64 and arm64 images pushed by the `images` job | GitHub Container Registry |
| Pull request `p4/docs-release` into `sprint/1-v1`; pull request `sprint/1-v1` into `main` | GitHub |
| Proposed O-IDs, if any | vault `planning/00-open-questions-and-risks.md` |
