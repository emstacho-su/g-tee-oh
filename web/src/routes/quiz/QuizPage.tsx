/**
 * The /quiz screen (S27 lane A, S41, R3.16, 05 section 8, O-301, O-302, O-350, O-414, O-415,
 * O-419). It replaces /predict.
 *
 * Mechanism: the address decides what shows. ?drill=<uuid> (an old link) starts a drill-backed
 * prediction session directly, without quiz options. A full valid quiz choice (config, positions,
 * spots, kinds, difficulty, quiz-search.ts) starts a catalog-spot quiz. Anything else shows the
 * start screen, filled from the address's valid parts or, after End quiz, from the quiz just ended.
 * Start writes the choice to the address, so a quiz is linkable; keying the run by its source and
 * seed starts a fresh session whenever either changes, and leaving the run (End quiz, another
 * address, a sign-out) unmounts it, which drops its answered list. Questions are unrated: nothing
 * on this screen shows a rating, score or grade label.
 */
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { PageHeader } from "../../components/ui/index.js";
import type { PredictionSource } from "../../prediction/api.js";
import { PREDICTION_TEXT } from "../../prediction/labels.js";
import { partialQuizChoice, quizChoiceOf, quizSearchOf, validateQuizSearch, type QuizChoice, type QuizSearch } from "../../practice/quiz-search.js";
import { QuizRun } from "./QuizRun.js";
import { QuizStart } from "./QuizStart.js";

export interface QuizPageProps {
  search: QuizSearch;
}

function sourceOf(search: QuizSearch): PredictionSource | null {
  if (search.drill !== undefined) return { kind: "drill", drillId: search.drill };
  const choice = quizChoiceOf(search);
  return choice === null ? null : { kind: "quiz", choice };
}

function runKey(source: PredictionSource, seed: string | undefined): string {
  const what = source.kind === "drill" ? source.drillId : JSON.stringify(source.choice);
  return `${source.kind}:${what}:${seed ?? ""}`;
}

export function QuizPage({ search }: QuizPageProps) {
  const navigate = useNavigate();
  // The router merges the parent's unvalidated search into the child's, so check it again here.
  const checked = validateQuizSearch({ ...search });
  const source = sourceOf(checked);
  const [lastChoice, setLastChoice] = useState<QuizChoice | null>(null);
  const start = (choice: QuizChoice) => void navigate({ to: "/quiz", search: quizSearchOf(choice, checked.seed) });
  const ended = () => {
    setLastChoice(source?.kind === "quiz" ? source.choice : null);
    void navigate({ to: "/quiz", search: {} });
  };
  return (
    <section className="flex flex-col gap-4">
      <PageHeader title={PREDICTION_TEXT.heading} description={PREDICTION_TEXT.intro} />
      {source === null ? (
        <QuizStart key={JSON.stringify(checked)} initial={{ ...(lastChoice ?? {}), ...partialQuizChoice(checked) }} onStart={start} />
      ) : (
        <QuizRun key={runKey(source, checked.seed)} source={source} seed={checked.seed} onEnded={ended} />
      )}
    </section>
  );
}
