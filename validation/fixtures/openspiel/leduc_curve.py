"""Generate the Leduc hold'em exploitability curve fixture for gate G3 (O-30, R0.11, R2.6).

Mechanism. OpenSpiel (Apache-2.0) ships a reference Leduc hold'em game and a plain
counterfactual regret minimization (CFR) solver. This script runs that solver for a fixed
iteration schedule and, at each checkpoint, measures how exploitable the average policy is.
The pairs (iteration, exploitability) are the curve that tools/validate G3 compares the
vendored engine against (04 section 6, G3). O-79 sets the tolerance: at every committed
checkpoint, the engine's exploitability must be within the larger of 0.001 absolute and
10 percent relative of the value recorded here.

What "exploitability" means here. OpenSpiel's exploitability(game, policy) is
nash_conv(game, policy) divided by the number of players, where nash_conv is the sum over
players of (best-response value against the policy minus the policy's own value). For a
two-player zero-sum game that is the mean best-response gain, in chips, with the ante
equal to 1. Both numbers are written so the comparison can use either.

The solver is the plain one: no regret matching plus, simultaneous updates, uniform
averaging, no discounting. Plain CFR is deterministic, so the seed changes nothing; it is
set and recorded anyway so the run is reproducible by command line alone.

The OpenSpiel wheel is Linux-only, so this runs inside a Linux container on the Windows
machine. PROVENANCE.md beside this file records the exact command, versions and digest.
"""

from __future__ import annotations

import argparse
import datetime as dt
import importlib.metadata
import json
import platform
import random
import sys
import time
from typing import Any

import numpy as np
import pyspiel
from open_spiel.python.algorithms import cfr, expected_game_score, exploitability

SCHEMA_VERSION = 1
FIXTURE_ID = "openspiel-leduc-exploitability-curve"
GAME_NAME = "leduc_poker"
DEFAULT_CHECKPOINTS = (1, 10, 100, 1000, 5000)
DEFAULT_SEED = 20261020
R_IDS = ("R0.11", "R2.6")
O_IDS = ("O-30", "O-79")


def parse_checkpoints(text: str) -> tuple[int, ...]:
    """Parse "1,10,100" into a strictly increasing tuple of positive iterations."""
    try:
        values = tuple(int(part.strip()) for part in text.split(",") if part.strip())
    except ValueError as error:
        raise argparse.ArgumentTypeError(f"checkpoints must be integers: {text!r}") from error
    if not values:
        raise argparse.ArgumentTypeError("at least one checkpoint is required")
    if any(value <= 0 for value in values):
        raise argparse.ArgumentTypeError(f"checkpoints must be positive: {values}")
    if any(later <= earlier for earlier, later in zip(values, values[1:])):
        raise argparse.ArgumentTypeError(f"checkpoints must be strictly increasing: {values}")
    return values


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", required=True, help="path of the JSON file to write")
    parser.add_argument(
        "--checkpoints",
        type=parse_checkpoints,
        default=DEFAULT_CHECKPOINTS,
        help="comma separated iterations at which exploitability is recorded",
    )
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED, help="recorded seed")
    return parser.parse_args(argv)


def game_parameters(game: pyspiel.Game) -> dict[str, Any]:
    """The game's parameters as plain JSON values."""
    plain: dict[str, Any] = {}
    for key, value in game.get_parameters().items():
        plain[key] = value if isinstance(value, (bool, int, float, str)) else str(value)
    return plain


def measure(game: pyspiel.Game, policy: Any) -> dict[str, float]:
    """Exploitability and NashConv of a policy, both in chips."""
    nash_conv = float(exploitability.nash_conv(game, policy))
    return {
        "exploitability": nash_conv / game.num_players(),
        "nash_conv": nash_conv,
    }


def run_curve(
    game: pyspiel.Game, checkpoints: tuple[int, ...], log: Any
) -> tuple[list[dict[str, float]], Any]:
    """Run plain CFR to the last checkpoint, measuring at each one.

    Returns the checkpoint rows and the final average policy. The solver is not reset
    between checkpoints: iteration n in the output is the state after n updates in one
    continuous run, which is what tools/validate G3 must reproduce.
    """
    solver = cfr.CFRSolver(game)
    rows: list[dict[str, float]] = []
    started = time.perf_counter()
    iteration = 0
    for target in checkpoints:
        while iteration < target:
            solver.evaluate_and_update_policy()
            iteration += 1
        measured = measure(game, solver.average_policy())
        row = {
            "iteration": iteration,
            "exploitability": measured["exploitability"],
            "nash_conv": measured["nash_conv"],
            "elapsed_seconds": round(time.perf_counter() - started, 3),
        }
        rows.append(row)
        log.write(
            f"iteration {iteration:>6}  exploitability {row['exploitability']:.9f}"
            f"  nash_conv {row['nash_conv']:.9f}  ({row['elapsed_seconds']:.1f} s)\n"
        )
        log.flush()
    return rows, solver.average_policy()


def build_report(
    game: pyspiel.Game,
    rows: list[dict[str, float]],
    average_policy: Any,
    seed: int,
    argv: list[str],
) -> dict[str, Any]:
    """Assemble the fixture document. Pure: no file access."""
    values = expected_game_score.policy_value(
        game.new_initial_state(), [average_policy] * game.num_players()
    )
    final_row = rows[-1]
    return {
        "schema_version": SCHEMA_VERSION,
        "fixture": FIXTURE_ID,
        "r_ids": list(R_IDS),
        "o_ids": list(O_IDS),
        "game": {
            "name": GAME_NAME,
            "string": str(game),
            "parameters": game_parameters(game),
            "num_players": game.num_players(),
            "information_states": len(average_policy.state_lookup),
            "max_game_length": game.max_game_length(),
        },
        "generator": {
            "library": "open_spiel",
            "version": importlib.metadata.version("open_spiel"),
            "module": "open_spiel.python.algorithms.cfr",
            "solver": "CFRSolver",
            "regret_matching_plus": False,
            "alternating_updates": False,
            "linear_averaging": False,
            "python": platform.python_version(),
            "platform": platform.platform(),
            "script": "validation/fixtures/openspiel/leduc_curve.py",
            "arguments": list(argv),
        },
        "seed": seed,
        "measure": {
            "exploitability": "nash_conv divided by num_players, chips, ante 1",
            "nash_conv": "sum over players of best-response value minus policy value, chips",
        },
        "checkpoints": rows,
        "final": {
            "iterations": final_row["iteration"],
            "exploitability": final_row["exploitability"],
            "nash_conv": final_row["nash_conv"],
            "average_policy_value": [float(value) for value in values],
        },
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    }


def write_json(path: str, document: dict[str, Any]) -> None:
    """Write the document with LF line endings and a trailing newline."""
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(document, handle, indent=2)
        handle.write("\n")


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    random.seed(args.seed)
    np.random.seed(args.seed)
    game = pyspiel.load_game(GAME_NAME)
    sys.stderr.write(f"{GAME_NAME}: {game.num_players()} players, seed {args.seed}\n")
    rows, average_policy = run_curve(game, args.checkpoints, sys.stderr)
    report = build_report(game, rows, average_policy, args.seed, argv)
    write_json(args.out, report)
    sys.stderr.write(f"wrote {args.out}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
