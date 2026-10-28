// The one error type of just perf (R3.3): a run that cannot go on or a report that must not be
// written. scripts/perf.mjs prints the message and exits 1; anything else is a bug and keeps its
// stack trace.

export class PerfError extends Error {
  constructor(message) {
    super(message);
    this.name = "PerfError";
  }
}
