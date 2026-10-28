/**
 * GapRequest (S28, R3.4, O-240, ADR 0018): ask the builder for a spot the library does not hold.
 * An uncovered pair offers a preflop request; any pair takes a flop typed in the field (checked
 * against the contract's flop shape before anything is sent). The answer reads in plain words,
 * with the queue position when the build was queued, in a polite live region. The request
 * returns at once: the screen shows "Sending" while the api answers and never waits on a solve.
 */
import { useId, useState, type FormEvent } from "react";

import { normalizeFlop, requestFailureText, requestResultText } from "../../library/request-text.js";
import type { GapRequestState } from "../../library/use-gap-request.js";
import { Button } from "../ui/index.js";

export interface GapRequestProps {
  pair: string;
  preflopAvailable: boolean;
  request: GapRequestState;
}

function targetText(flop: string | undefined, pair: string): string {
  return flop === undefined ? `${pair} preflop` : `${pair} on ${flop}`;
}

function Outcome({ request, pair }: { request: GapRequestState; pair: string }) {
  if (request.target === undefined) return null;
  const subject = targetText(request.target.flop, pair);
  if (request.pending) return <p className="text-sm text-muted">{`Sending the request for ${subject}.`}</p>;
  if (request.error !== null) {
    return (
      <p role="alert" className="text-sm text-danger">
        {`${subject}: ${requestFailureText(request.error)}`}
      </p>
    );
  }
  if (request.result === undefined) return null;
  return (
    <p data-testid="gap-request-result" className="text-sm font-medium">
      {`${subject}: ${requestResultText(request.result)}`}
    </p>
  );
}

export function GapRequest({ pair, preflopAvailable, request }: GapRequestProps) {
  const flopId = useId();
  const [flopText, setFlopText] = useState("");
  const [flopError, setFlopError] = useState<string | null>(null);

  function submitFlop(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const flop = normalizeFlop(flopText);
    if (flop === null) {
      setFlopError("Type three different cards, rank then suit, for example KhQd4s.");
      return;
    }
    setFlopError(null);
    request.send({ flop });
  }

  return (
    <section aria-labelledby="gap-request-heading" className="flex flex-col gap-3">
      <h2 id="gap-request-heading" className="text-lg font-semibold">
        Request coverage
      </h2>
      <p className="text-sm text-muted">
        A request raises a queued build to the head of the queue or records it for the planner. Nothing is solved while you wait.
      </p>
      {preflopAvailable ? null : (
        <Button variant="primary" className="self-start" disabled={request.pending} onClick={() => request.send({})}>
          {`Request ${pair} preflop`}
        </Button>
      )}
      <form onSubmit={submitFlop} className="flex flex-wrap items-end gap-2" noValidate>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={flopId} className="font-medium">
            Flop
          </label>
          <input
            id={flopId}
            value={flopText}
            maxLength={12}
            autoComplete="off"
            spellCheck={false}
            placeholder="KhQd4s"
            aria-invalid={flopError !== null}
            onChange={(event) => setFlopText(event.target.value)}
            className="h-9 w-32 rounded-md border border-border bg-surface-raised px-2 font-mono"
          />
        </div>
        <Button type="submit" disabled={request.pending}>
          Request this flop
        </Button>
      </form>
      {flopError === null ? null : (
        <p role="alert" className="text-sm text-danger">
          {flopError}
        </p>
      )}
      <div aria-live="polite">
        <Outcome request={request} pair={pair} />
      </div>
    </section>
  );
}
