---
id: 'g-tee-oh-handoff-s04-mac-bootstrap'
title: 'S04 Mac bootstrap'
collection: 'g-tee-oh'
type: handoff
status: 'done 2026-11-04: Mac run passed O-50, mac-bootstrap.md written, pull request 53 open for the owner to merge'
created: 2026-10-19
public: true
phase: 0
session: 'S04'
branch: 'p0/mac-bootstrap'
tags: [g-tee-oh, handoff, phase-0]
---
# S04 Mac bootstrap (paste-ready)

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/phases/phase-0-foundations|Phase 0 Foundations and test scaffolding]]. This session bootstraps the Mac per O-20 and runs the throwaway flop-solve benchmark (R0.9, O-47, O-50); its only repo output is `validation/reports/mac-bootstrap.md`, which closes the Mac part of the Phase 0 gate. Branch `p0/mac-bootstrap` off `sprint/1-v1` in the Zenbook clone, where the report is committed. Parallel group A, any evening through day 8 (2026-10-27), and it may slip to any evening before S20 (O-67); paced week 1 or 2. Single session: the owner is at the Mac keyboard and Claude reads the checklist back, one item at a time. Public. Usage low (1 unit).

## Before pasting

- [ ] S01 merged into `sprint/1-v1` is preferred, so the benchmark builds the vendored engine. 09 section 3 lists no blocker for S04, so if it runs before S01 lands the benchmark builds the upstream engine at the commit S01 will pin (ADR 0002) and the Dockerfile path is adjusted when S01 merges. S02 is not needed.
- [ ] At hand: the Mac on its power adapter, its administrator password, the external drive, the Docker Desktop installer or an installed Docker runtime, and about two hours: the image build, the native build and two measured runs of up to 30 minutes each (the 2026-11-04 run sheet below).
- [ ] This session runs in PowerShell on the Zenbook; the owner types each Mac command by hand and pastes its output back.
- [ ] The vault is readable through `/add-dir`.

## How to start

```powershell
cd C:\Users\stack\projects\g-tee-oh
git fetch origin
git switch sprint/1-v1
git pull
git switch -c p0/mac-bootstrap
claude
```

1. Run `/add-dir C:\Users\stack\vault\projects\g-tee-oh` so the session can read the vault and append open-question identifiers (O-IDs) to `planning/00-open-questions-and-risks.md`.
2. Stay in the default permission mode.
3. Paste the prompt.

## The prompt

```text
You are running session S04 of sprint 1 of g-tee-oh, Phase 0 (Foundations and test scaffolding), on branch p0/mac-bootstrap off the sprint branch sprint/1-v1. Goal: the Mac bootstrapped per O-20 and a throwaway flop-solve benchmark inside a 5 GB memory limit, reported in validation/reports/mac-bootstrap.md (R0.9). The owner sits at the Mac; you are the checklist. Nothing stays running on the Mac afterwards (O-47), and no service is deployed: Deploy 1 is S20 and needs the owner's explicit yes at that moment (O-20).

## Reading order
The vault is C:\Users\stack\vault\projects\g-tee-oh (added with /add-dir). Read in order:
1. planning/phases/phase-0-foundations.md
2. planning/09-v1-sprint-roadmap.md: sections 5 (row S04), 6 (R0.9), 7 (the Mac part of the gate), 8 (the Mac memory row)
3. planning/00-open-questions-and-risks.md: risks R-9, R-17, R-18; O-20, O-23, O-47, O-48, O-50, O-59, O-67
4. planning/02-architecture.md section 6.2; planning/architecture/A9-quality-security-ops.md section 5
5. decisions/_README.md, then architecture decision record (ADR) 0002
6. The repo: CLAUDE.md, crates/vendor/postflop-engine/UPSTREAM.md and the engine's own README for its example or benchmark entry point

## Rules
- Session on the Zenbook in PowerShell at C:\Users\stack\projects\g-tee-oh (O-23); the Mac commands are typed by the owner; you never run anything against the Mac remotely.
- Branch p0/mac-bootstrap; merge by pull request into sprint/1-v1; sprint/1-v1 merges into main only in S35 (R4.18).
- Gates: plan first (plan mode, wait for approval), task list, smallest increment, tests green where there are tests, /code-review on the Dockerfile and just target, /security-review not needed unless a secret appears, conventional commits ending with the line "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" (O-29).
- Accepted ADRs are fixed. Cite O-IDs in the report.
- Privacy boundary (O-26, ADR 0017): the report carries only docker info memory, the power setting, peak resident set size (RSS) and seconds per iteration, plus the date, the engine commit and the pass or fail line. No hostnames, serial numbers, drive names or anything about capture.
- Documentation you write: no em dashes or en dashes, no bold, acronyms expanded on first use, mechanism before conclusion.
- No dynamic workflow in this session.
- Report honestly: a benchmark that misses O-50 is recorded as a miss, not softened.

## Inputs
- The vendored engine at crates/vendor/postflop-engine on sprint/1-v1.
- The Mac (2023 MacBook Pro, M2 Pro, 16 GB), its power adapter and the external drive.

## Requirement this session closes
- R0.9 Mac bootstrapped per O-20: Docker virtual machine at 10 GB and all but 2 cores, sleep prevented on power, external drive mounted, repo cloned, release build cache warmed; a throwaway arm64 flop-solve benchmark of the vendored engine inside a 5 GB memory limit (O-47). Proof: validation/reports/mac-bootstrap.md on p0/mac-bootstrap against the O-50 pass rule (peak RSS under 5 GB and under 30 minutes to 0.3 percent pot per preflop line on the simple tree at 100 big blinds (bb) with 16-bit storage); it closes the Mac part of the Phase 0 gate whenever it lands, no later than S20 (O-67).

## Steps
1. (single) Read, plan in plan mode, and walk the owner through the checklist below before starting, so the owner knows the order and the stop points.
2. (single) Write infra/docker/engine-bench.Dockerfile (multi-stage, arm64-capable, builds a small bench binary from the vendored engine that solves one simple-tree 100bb flop line with 16-bit storage to 0.3 percent pot, printing iterations, seconds per iteration, elapsed minutes and peak RSS) and a just mac-bench target that builds it with docker buildx for linux/arm64 and runs it with --rm --memory=5g --memory-swap=5g --name gto-bench. Commit and push the branch so the Mac can fetch it.
3. (single) Checklist at the Mac. Read one item, wait for the pasted output, record it, then move on:
   a. Docker: install or open Docker Desktop; Settings, Resources: memory 10 GB, CPUs (central processing unit cores) all but 2; apply and restart; docker info | grep -E "Total Memory|CPUs". Record both.
   b. Sleep: System Settings, Battery, Options: prevent automatic sleeping on power adapter when the display is off, on; pmset -g custom shows sleep 0 under AC Power (AC, alternating current, meaning the adapter). Record the line (risk R-17).
   c. Drive: attach the external drive; df -h on its mount point shows it mounted. Record only that it is mounted; the owner writes the mount path into the Mac clone's gitignored .env as BACKUP_DRIVE_PATH for S20, not into the report.
   d. Toolchains: xcode-select --install if needed; rustup stable; just; git. git clone https://github.com/emstacho-su/g-tee-oh.git ~/projects/g-tee-oh, then git switch p0/mac-bootstrap.
   e. Claude Code installed on the Mac (claude --version) so S20 and S34 can run there (O-59).
   f. Warm the cache: cargo build --release -p postflop-engine in the clone; note the seconds in the chat, not the report.
   g. Benchmark: just mac-bench in one terminal; in a second, docker stats gto-bench --no-stream every few minutes and paste the MEM USAGE (memory usage) column; stop at 30 minutes if the target is not reached and record a miss (O-50). Record peak RSS, seconds per iteration, iterations and minutes to target.
   h. Clean up: docker rm -f gto-bench if still present; docker rmi the bench image; docker ps -a shows nothing from this session (O-47).
4. (single) Write validation/reports/mac-bootstrap.md with: date, engine commit, docker info memory and CPUs, the power setting line, peak RSS, seconds per iteration, iterations, minutes to target, pass or fail against O-50, and the sentence that nothing is left running (O-47). Nothing else.
5. (single) /code-review, then open the pull request into sprint/1-v1 with R0.9 in the template.

## Definition of done
- [ ] Mac settings applied and recorded: 10 GB and all but 2 cores, sleep prevented on power, drive mounted
- [ ] Clone at ~/projects/g-tee-oh on the Mac, release build cache warm, Claude Code installed there (O-59)
- [ ] Benchmark run inside --memory=5g with peak RSS and seconds per iteration recorded; pass or fail against O-50 stated
- [ ] docker ps -a clean on the Mac; no service started (O-47, O-20)
- [ ] validation/reports/mac-bootstrap.md written with only the allowed fields; /code-review done; pull request opened into sprint/1-v1

## Report back
The final message lists R0.9 with the report path and the O-50 verdict; the branch and pull request link; the files written (the report, the Dockerfile, the just target); usage notes (units used against the planned low level); and any new question as a proposed O-ID with a default, appended to planning/00-open-questions-and-risks.md under a new dated subsection. If the benchmark missed O-50, the message says which figure missed and by how much, so S18's planner estimates and S20 start from the real number (risk R-9).
```

## What comes out

| File or artifact | Where it lands |
|---|---|
| `validation/reports/mac-bootstrap.md` (memory, power setting, peak RSS, seconds per iteration, O-50 verdict) | repo, branch `p0/mac-bootstrap`; closes the Mac part of the Phase 0 gate |
| `infra/docker/engine-bench.Dockerfile`, `just mac-bench` | repo; reused by S20 for the Mac rerun (R2.21) |
| Mac state: Docker at 10 GB and all but 2 cores, sleep prevented on power, drive mounted, clone at `~/projects/g-tee-oh`, warm release cache, Claude Code installed | the Mac; nothing running (O-47) |
| `BACKUP_DRIVE_PATH` in the Mac clone's gitignored `.env` | the Mac only, for S20 |
| Pull request `p0/mac-bootstrap` into `sprint/1-v1` | GitHub |
| New O-IDs, if any | vault `planning/00-open-questions-and-risks.md` |

## Status (2026-11-04)

In progress on `p0/mac-bootstrap` off `sprint/1-v1` at 6543644, after the bridge sprint merged in full. The Mac was bootstrapped for the harness and other projects first (Docker Desktop, Claude Code, Tailscale on both machines), so the g-tee-oh items of step 3 are confirmed in this run and the benchmark is still to run.

Deviation, recorded as O-506: no `engine-bench.Dockerfile`. `just mac-bench` reuses the S18 flop-line benchmark (the `library-builder` image for linux/arm64, the judged 32-bit and the informational 16-bit job specs under the 5 GB cap, then `estimate` and `bench-report` on the host), so the Mac writes `bench-flop-line-mac.json` and its Markdown twin and `mac-bootstrap.md` summarises them. `just mac-bench-clean` removes the container, its scratch volume and the image (O-47). A Zenbook trial of the recipe (machine `zenbook-trial`, output under `target/bench/trial`, nothing committed) runs before the push. Tailscale is recorded as O-505; it changes nothing in this session.

Mac run sheet, one item at a time, outputs pasted back into the Zenbook session (needs git, just, Node, rustup stable and Docker Desktop on the Mac, per the harness runbook):

1. `docker info --format 'mem={{.MemTotal}} cpus={{.NCPU}}'`: 10 GB and all but 2 cores (Docker Desktop, Settings, Resources; apply and restart).
2. `pmset -g custom`: sleep 0 under AC Power (System Settings, Battery, Options, prevent automatic sleeping on power adapter when the display is off).
3. `df -h <mount point>` with the external drive attached. The mount path goes into the Mac clone's gitignored `.env` as `BACKUP_DRIVE_PATH`, never into the report.
4. `git clone https://github.com/emstacho-su/g-tee-oh.git ~/projects/g-tee-oh` (or `git fetch` in an existing clone), then `cd ~/projects/g-tee-oh`, `git switch p0/mac-bootstrap`, `just hooks`.
5. `cargo build --release -p library-builder`: warms the cache and builds the report step; note the minutes in chat.
6. `claude --version`.
7. `just mac-bench` (defaults: machine `mac`, the platform of the host, output `validation/reports`). In a second terminal run `docker stats --no-stream` every few minutes and paste the MEM USAGE column of the `gto-bench` and `gto-bench-16bit` rows. Do not stop the container by hand: each line stops itself at the spec's 30-minute budget and the report records the miss (O-50, O-178). If Docker kills the container for memory, the recipe still runs `bench-report`, which fails on the missing summary; there is then no `bench-flop-line-mac` report, and `mac-bootstrap.md` records the kill as the miss from the output and the memory figures you pasted (O-178). On a miss the recipe exits non-zero although both report files are written; step 8 still applies, since a miss is recorded, never softened (O-178).
8. `git add validation/reports/bench-flop-line-mac.json validation/reports/bench-flop-line-mac.md`, then `git commit -m "test(validate): R0.9 Mac flop-line benchmark against O-50"` and `git push`. The owner's own commit needs no trailer; the hook asks for it only under Claude Code. A committed miss fails `just report-check` on purpose (validation/reports/README.md, the flop-line section), so the pull request stays red until the gate answers it with the R-9 fallbacks.
9. `just mac-bench-clean`, then `docker ps -a` shows no container and `docker volume ls` no `gto-bench-scratch`; `docker images` shows no `g-tee-oh/library-builder:bench` (the two base images it pulled, rust and debian, may remain; O-47 is about nothing running).

The Zenbook session then pulls, writes `validation/reports/mac-bootstrap.md` from items 1, 2, 7 and the Mac report, updates the Mac rows of `phase-0-gate.md`, runs the checks and the code review, and opens the pull request into `sprint/1-v1` for the owner to merge.

## Done (2026-11-04, evening)

The owner ran the sheet on the Mac the same evening. `bench-flop-line-mac.md`: verdict pass against O-50, peak RSS 1,489,641,472 bytes under the 5 GB cap, the judged line to 0.3 percent of the pot in 232 seconds (the Zenbook took 358). `validation/reports/mac-bootstrap.md` summarises it; the Docker virtual machine reads 10 GB and 10 cores; the power setting and Claude Code on the Mac are owner-confirmed without a pasted line. `just mac-bench-clean` left nothing of the run (O-47). Pull request 53 carries the recipe, four code-review rounds of fixes, the report and the 2026-11-04 replan mirror; the owner merges it with `gh pr merge 53 --merge`. The Phase 0 gate then closes in full. Follow-ups for the next builder session: a `--commit` flag on `bench-report` so the report step runs inside the image, and a failed report from a missing judged summary.
