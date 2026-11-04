# Mac bootstrap: the Phase 0 gate, Mac part (R0.9)

Written by S04 on 2026-11-04 from the tool-written `bench-flop-line-mac.md` and the owner's run sheet (O-506); the Mac part of the Phase 0 gate closes with it (O-20, O-47, O-50, O-67). Not edited after the gate closes.

- Date: 2026-11-04 (the measured run finished at 2026-11-04T19:29:26Z)
- Repository commit the Mac ran: 074d80c789dcf149095f1322f4b2f6108847347a (branch `p0/mac-bootstrap`, pull request 53). The branch's later commits changed only the recipe's guards (the resets, the platform refusal, the output probe, the order of `estimate`), not the measured method or the cap.
- Engine commit: 5fc7ee3d92b823b6c58e4f58cbee7d50d5e9e6de (the vendored `postflop-engine`, `crates/vendor/UPSTREAM-postflop-engine.md`)
- Docker virtual machine: 10 GB of memory and 10 logical cores, as the measured process read them inside the container (O-20: 10 GB and all but 2 cores)
- Power setting: sleep prevented on the power adapter, confirmed by the owner on 2026-11-04; the `pmset -g custom` line was not pasted into the record (risk R-17)
- Container cap: 5,368,709,120 bytes (`--memory 5g --memory-swap 5g`, O-48)

## Measurement (O-50)

| Run | Peak RSS (bytes) | Seconds | Iterations | Seconds per iteration | Minutes to target | Target reached |
|---|---|---|---|---|---|---|
| Judged, 32-bit storage, line `r250.c` of the O-52 flop `Kh7d2c` | 1,489,641,472 (cgroup `memory.peak`; `VmHWM` 1,479,749,632) | 232.09 | 240 | 0.97 | 3.9 | yes: 0.253 and 0.284 percent of the pot against the 0.3 limit |
| Informational, 16-bit storage at the 0.5 percent floor (O-200) | 814,030,848 | 258.16 | 210 | 1.23 | 4.3 | yes: 0.404 and 0.488 against 0.5 |

Verdict against O-50: pass. Peak RSS 1,489,641,472 bytes is under 5,000,000,000 bytes, and the judged line reached 0.3 percent of the pot in 232 seconds, under the 1,800-second limit. The Zenbook's run of the same job (`bench-flop-line-zenbook.md`, S18) took 358 seconds at a peak of 1,490,747,392 bytes, so the Mac is faster at the same memory.

## Nothing left running (O-47)

After `just mac-bench-clean` on the Mac, `docker ps -a` showed no container from this run, `docker volume ls` no `gto-bench-scratch`, and `docker images` no `g-tee-oh/library-builder:bench`. No service was started; Deploy 1 is S20 and waits for the owner's explicit yes (O-20).
