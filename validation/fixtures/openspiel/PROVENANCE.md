# Provenance of leduc_exploitability.json

`leduc_exploitability.json` is the OpenSpiel Leduc hold'em exploitability curve that gate G3 compares the vendored engine against (open question identifier (O-ID) O-30; requirement identifiers (R IDs) R0.11 and R2.6). `leduc_curve.py` in this directory produced it in one run: it loads OpenSpiel's `leduc_poker`, runs the library's plain counterfactual regret minimization (CFR) solver for 5000 iterations, and at each checkpoint measures the exploitability of the average policy. The file was committed as written and has not been edited by hand. A rerun with the same version reproduces every number, because plain CFR is deterministic; the seed below is recorded for form.

| Item | Value |
|---|---|
| Fixture | `validation/fixtures/openspiel/leduc_exploitability.json`, `schema_version` 1 |
| OpenSpiel version | 2.0.2, the wheel `open_spiel==2.0.2` from the Python Package Index (Apache-2.0), installed with pip 25.0.1 into Python 3.12.15 |
| Solver | `open_spiel.python.algorithms.cfr.CFRSolver` with `regret_matching_plus` false, `alternating_updates` false and `linear_averaging` false, that is plain CFR: simultaneous updates, uniform averaging, no discounting |
| Game | `leduc_poker` with default parameters (`players` 2, `starting_player` 0, `suit_isomorphism` false, `action_mapping` false): 936 information states, maximum game length 8 moves |
| Measure | `exploitability` is `nash_conv` divided by 2 (the mean best-response gain, chips, ante 1); `nash_conv` is the sum over both players of best-response value minus policy value |
| Checkpoints | 1, 10, 100, 1000 and 5000 iterations, one continuous run (the script's default schedule) |
| Seed | 20261020, applied to `random` and `numpy.random`; plain CFR draws no random numbers |
| Command | see below |
| Container image | `python:3.12-slim`, digest `sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1` as Docker Desktop reports it, image created 2026-10-06 |
| Container platform | Linux 6.18.33.2-microsoft-standard-WSL2, x86_64, glibc 2.41 (the Windows Subsystem for Linux 2 kernel of Docker Desktop) |
| Docker | Docker Desktop, engine 29.9.1, WSL2 backend |
| Date | 2026-10-20; the file's `generated_at` is 2026-10-20T17:37:14+00:00 (Coordinated Universal Time) |
| Machine | Zenbook, the Windows 11 Home 10.0.26200 laptop that runs the sprint sessions (O-23), from the S05 worktree `C:\Users\stack\projects\g-tee-oh-s05` on branch `p0/test-vectors` |
| Elapsed | 527.8 seconds of solving to iteration 5000, pip install excluded |

The exact command line, run from PowerShell on the Zenbook, with this directory's parent mounted at `/out`:

```text
docker run --rm -v "C:/Users/stack/projects/g-tee-oh-s05/validation/fixtures:/out" python:3.12-slim sh -c "pip install --quiet open_spiel==2.0.2 && python -I /out/openspiel/leduc_curve.py --out /out/openspiel/leduc_exploitability.json --seed 20261020"
```

O-30 says the curve is generated once with uv. The OpenSpiel wheel is built for Linux only, so on the Windows machine uv cannot install it; the run used pip inside a Linux container instead, with the version pinned exactly. On Linux or macOS the same script runs under uv as `validation/fixtures/README.md` shows, and a rerun there at version 2.0.2 should reproduce the numbers below.

## Results

| Iteration | Exploitability (chips) | NashConv (chips) | Elapsed (s) |
|---|---|---|---|
| 1 | 2.373611111111111 | 4.747222222222222 | 0.3 |
| 10 | 0.888578983168769 | 1.777157966337538 | 1.3 |
| 100 | 0.09571635300459762 | 0.19143270600919524 | 10.1 |
| 1000 | 0.011817810259786288 | 0.023635620519572575 | 97.7 |
| 5000 | 0.003552366213441127 | 0.007104732426882254 | 527.8 |

Final average policy value after 5000 iterations: minus 0.0859431179350123 chips to player 0 and the same amount to player 1, zero-sum.

## Determinism check

Before the committed run, a probe run of the same script in the same image with `--checkpoints 1,10,50`, written to a scratch directory and not committed, gave exploitability 2.373611111 at iteration 1 and 0.888578983 at iteration 10, identical to the committed run at those checkpoints.
