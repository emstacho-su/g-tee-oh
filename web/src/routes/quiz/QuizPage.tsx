/**
 * The /quiz screen (S27 lane A, S41, R3.16, 05 section 8, O-301, O-302, O-350, O-414, O-415,
 * O-419). It replaces /predict.
 *
 * Mechanism: the address only prefills; a session starts on the player's Start, never because a
 * link was opened (PR #39 security LOW 2). ?drill=<uuid> (an old link) shows a start card naming
 * the drill-backed quiz; anything else shows the start screen, filled from the address's valid
 * parts (a full valid choice fills every field, quiz-search.ts) or, after End quiz, from the quiz
 * just ended. Start writes the choice to the address, so a quiz is linkable, and arms the run for
 * exactly that address: the run mounts only while the address matches what was armed, keyed by its
 * source and seed, so another address (a pasted link included) goes back to the start screen
 * instead of starting. Leaving the run (End quiz, another address, a sign-out) unmounts it, which
 * drops its answered list. Questions are unrated: nothing on this screen shows a rating, score or
 * grade label.
 */
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { DrillStartCard } from "../../components/practice/DrillStartCard.js";
import { PageHeader } from "../../components/ui/index.js";
import type { PredictionSource } from "../../prediction/api.js";
import { PREDICTION_TEXT } from "../../prediction/labels.js";
import { DRILL_QUIZ_TEXT, QUIZ_START_TEXT } from "../../prediction/quiz-text.js";
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

/** The run key of an address as the route will validate it, so a Start and its address agree. */
function addressKey(search: QuizSearch): string | null {
  const checked = validateQuizSearch({ ...search });
  const source = sourceOf(checked);
  return source === null ? null : runKey(source, checked.seed);
}

export function QuizPage({ search }: QuizPageProps) {
  const navigate = useNavigate();
  // The router merges the parent's unvalidated search into the child's, so check it again here.
  const checked = validateQuizSearch({ ...search });
  const source = sourceOf(checked);
  const currentKey = addressKey(checked);
  const [armed, setArmed] = useState<string | null>(null);
  const [lastChoice, setLastChoice] = useState<QuizChoice | null>(null);
  const start = (choice: QuizChoice) => {
    const next = quizSearchOf(choice, checked.seed);
    setArmed(addressKey(next));
    void navigate({ to: "/quiz", search: next });
  };
  const ended = () => {
    setArmed(null);
    setLastChoice(source?.kind === "quiz" ? source.choice : null);
    void navigate({ to: "/quiz", search: {} });
  };
  const running = source !== null && currentKey !== null && currentKey === armed;
  return (
    <section className="flex flex-col gap-4">
      <PageHeader title={PREDICTION_TEXT.heading} description={PREDICTION_TEXT.intro} />
      {running ? (
        <QuizRun key={currentKey} source={source} seed={checked.seed} onEnded={ended} />
      ) : source?.kind === "drill" ? (
        <DrillStartCard title={DRILL_QUIZ_TEXT.title} body={DRILL_QUIZ_TEXT.body} startLabel={QUIZ_START_TEXT.start} onStart={() => setArmed(currentKey)} />
      ) : (
        <QuizStart key={JSON.stringify(checked)} initial={{ ...(lastChoice ?? {}), ...partialQuizChoice(checked) }} onStart={start} />
      )}
    </section>
  );
}
