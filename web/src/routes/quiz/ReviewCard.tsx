/**
 * The read-only review of an earlier quiz answer (S41, R3.16, O-414): the answered item as the
 * player saw and sent it (the prompt with every input disabled and the answer filled, the reason as
 * text, the result with its reveal and no Next), and the steps between answers: Previous goes one
 * older (disabled at the oldest), Newer one newer (disabled at the newest), Back to current
 * question returns to the question in progress. Everything comes from the run's client state;
 * nothing is fetched or written.
 */
import { Button } from "../../components/ui/index.js";
import type { AnsweredItem } from "../../prediction/answered.js";
import { PREDICTION_TEXT, type RunFlavor } from "../../prediction/labels.js";
import { PromptCard } from "./PromptCard.js";
import { ResultCard } from "./ResultCard.js";

export interface ReviewCardProps {
  item: AnsweredItem;
  index: number;
  count: number;
  flavor: RunFlavor;
  /** The quiz's difficulty name, as on the current question; absent for a drill-backed run. */
  difficulty?: string;
  onOlder: () => void;
  onNewer: () => void;
  onBack: () => void;
}

const ignore = (): void => undefined;

export function ReviewCard({ item, index, count, flavor, difficulty, onOlder, onNewer, onBack }: ReviewCardProps) {
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Earlier answers" className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onOlder} disabled={index === 0}>
          {PREDICTION_TEXT.previous}
        </Button>
        <Button size="sm" onClick={onNewer} disabled={index >= count - 1}>
          {PREDICTION_TEXT.newer}
        </Button>
        <Button size="sm" variant="primary" onClick={onBack}>
          {PREDICTION_TEXT.backToCurrent}
        </Button>
        <span className="text-sm text-muted">
          Answer {index + 1} of {count}
        </span>
      </nav>
      <div data-testid="answer-review" className="flex flex-col gap-4">
        <PromptCard
          prompt={item.prompt}
          draft={item.draft}
          reason={item.reason}
          answered
          readOnly
          {...(difficulty === undefined ? {} : { difficulty })}
          canSubmit={false}
          submitting={false}
          onDraft={ignore}
          onReason={ignore}
          onSubmit={ignore}
        />
        <ResultCard result={item.result} flavor={flavor} />
      </div>
    </div>
  );
}
