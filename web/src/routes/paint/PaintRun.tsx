/**
 * One range-painting session on /paint (S27 lane B, R3.17, O-300, O-302, ADR 0018): load the node
 * to paint, paint it, submit, read the grade, Next.
 *
 * Mechanism: the prompt is GET /range-paint/{session}/next keyed by the session and the state
 * version it follows (pure, so a cached prompt never goes stale for its version). RangePainter is
 * keyed by the prompt's version, so each prompt starts a fresh paint. Submit posts the painted map
 * with a new Idempotency-Key (useTrainerDeps, O-232); the answer replaces the painter with the
 * graded view, and Next moves to the version the answer carries. A stale-state answer (another tab
 * moved the session on) offers to load the current range: the prompt is read again and painted
 * from scratch. Failures show fixed sentences (paint-api.ts paintFailureText), never a problem's
 * text.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useAppApi } from "../../auth/index.js";
import { PaintGradedView } from "../../components/painter/PaintGradedView.js";
import { RangePainter } from "../../components/painter/RangePainter.js";
import { Button, LoadingNote, SyntheticBanner } from "../../components/ui/index.js";
import type { RangePaintPrompt, RangePaintResult } from "../../contracts.js";
import { useTrainerDeps } from "../../trainer/trainer-deps.js";
import { isStalePaint, paintFailureText, paintPromptQuery, submitPaint } from "./paint-api.js";

export const RUN_TEXT = {
  loading: "Loading the range to paint.",
  submitting: "Grading your range.",
  retry: "Try again",
  reload: "Load the current range",
} as const;

export interface PaintRunProps {
  sessionId: string;
  initialVersion: number;
}

interface PromptHeaderProps {
  prompt: RangePaintPrompt;
}

function PromptHeader({ prompt }: PromptHeaderProps) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-xl font-semibold">Range {prompt.prompt_no + 1}</h2>
      <p className="text-sm">
        <span className="text-muted">Paint the range of </span>
        <span className="font-semibold">{prompt.hero_position}</span>
        {prompt.history.length === 0 ? <span className="text-muted"> first to act.</span> : <span className="text-muted"> after </span>}
        {prompt.history.map((entry, index) => (
          <span key={`${entry.position}-${entry.token}-${index}`} className="font-medium">
            {index > 0 ? ", " : ""}
            {entry.position} {entry.label}
          </span>
        ))}
      </p>
    </div>
  );
}

interface FailureProps {
  error: unknown;
  action: string;
  onAction: () => void;
}

function Failure({ error, action, onAction }: FailureProps) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-danger px-3 py-2 text-sm">
      <span>{paintFailureText(error)}</span>
      <Button size="sm" onClick={onAction}>
        {action}
      </Button>
    </div>
  );
}

export function PaintRun({ sessionId, initialVersion }: PaintRunProps) {
  const api = useAppApi();
  const { newKey } = useTrainerDeps();
  const [version, setVersion] = useState(initialVersion);
  const [result, setResult] = useState<RangePaintResult | null>(null);
  const prompt = useQuery(paintPromptQuery(api, sessionId, version));
  const submit = useMutation({
    mutationFn: (paint: Record<string, number>) => {
      if (prompt.data === undefined) throw new Error("no prompt to submit against");
      return submitPaint(api, { prompt: prompt.data, paint, key: newKey() });
    },
    onSuccess: setResult,
  });
  const reload = () => {
    submit.reset();
    void prompt.refetch();
  };
  const resubmit = () => {
    if (submit.variables !== undefined) submit.mutate(submit.variables);
  };
  const next = (graded: RangePaintResult) => {
    setResult(null);
    submit.reset();
    setVersion(graded.state_version);
  };
  const data = prompt.data;
  return (
    <div className="flex flex-col gap-4">
      {prompt.isPending ? <LoadingNote text={RUN_TEXT.loading} /> : null}
      {prompt.isError ? <Failure error={prompt.error} action={RUN_TEXT.retry} onAction={() => void prompt.refetch()} /> : null}
      {submit.isError ? (
        <Failure error={submit.error} action={isStalePaint(submit.error) ? RUN_TEXT.reload : RUN_TEXT.retry} onAction={isStalePaint(submit.error) ? reload : resubmit} />
      ) : null}
      {data === undefined || prompt.isError ? null : (
        <>
          <PromptHeader prompt={data} />
          {data.synthetic ? <SyntheticBanner /> : null}
          {result === null ? (
            <RangePainter key={`${data.session_id}:${data.state_version}`} prompt={data} submitting={submit.isPending} onSubmit={(paint) => submit.mutate(paint)} />
          ) : (
            <PaintGradedView prompt={data} result={result} onNext={() => next(result)} />
          )}
          {submit.isPending ? <LoadingNote text={RUN_TEXT.submitting} /> : null}
        </>
      )}
    </div>
  );
}
