/**
 * The range view in the feedback panel (S25, R3.13, O-281, 05 section 5 step 4).
 *
 * Mechanism: predict before peek. The decision feedback names the decided node (config_id, pair,
 * node_key, O-281), so only after the decision does this read that node through
 * studyNodeByKeyQuery, the shared study query factory, and draw it as a RangeMatrix in frequency
 * mode with the hero's class selected. The hero's hand may arrive as a class or as two cards;
 * heroHandClass names the class (naming, not poker math, ADR 0004), and a hand it cannot name
 * shows the range with no selection and a note. The view is read-only: selecting another cell
 * does nothing here (the study screen is where a range is explored). The api serves preflop nodes
 * only in v1, so a postflop node shows a v1.5 note instead of a matrix (RangeMatrix never meets
 * exact-combination rows, O-196). Loading and failures are explicit (FeedbackQueryState).
 */
import { useQuery } from "@tanstack/react-query";

import { useAppApi } from "../../auth/index.js";
import type { DecisionFeedback, StudyNode } from "../../contracts.js";
import { heroHandClass } from "../../poker/hand-class.js";
import { useThemeStore } from "../../store/index.js";
import { studyNodeByKeyQuery } from "../../study/queries.js";
import { RangeMatrix } from "../range-matrix/RangeMatrix.js";
import type { MatrixMode } from "../range-matrix/model.js";
import { LoadingNote } from "../ui/index.js";
import { QueryFailure } from "./FeedbackQueryState.js";

export interface FeedbackRangeViewProps {
  feedback: DecisionFeedback;
}

const FEEDBACK_MATRIX_MODE: MatrixMode = "frequency";
const PREFLOP: StudyNode["street"] = "preflop";
/** Smaller than the study screen's matrix: the panel shares the screen with the table. */
const FEEDBACK_MATRIX_SIZE_PX = 390;

const ignoreSelection = (): void => undefined;

function caption(heroClass: string | null): string {
  const intro = "The range at this decision, by action frequency.";
  return heroClass === null
    ? `${intro} Your hand could not be placed on the matrix.`
    : `${intro} Your hand, ${heroClass}, is highlighted.`;
}

interface RangeBodyProps {
  node: StudyNode;
  heroClass: string | null;
}

function RangeBody({ node, heroClass }: RangeBodyProps) {
  const theme = useThemeStore((state) => state.theme);
  if (node.street !== PREFLOP) {
    return (
      <p data-testid="feedback-range-view-postflop" className="text-sm text-muted">
        {`The range view for ${node.street} decisions arrives with postflop study in v1.5.`}
      </p>
    );
  }
  return (
    <figure
      data-testid="feedback-range-view"
      data-mode={FEEDBACK_MATRIX_MODE}
      {...(heroClass === null ? {} : { "data-selected-hand": heroClass })}
      className="flex flex-col gap-2"
    >
      <figcaption className="text-sm">{caption(heroClass)}</figcaption>
      <RangeMatrix
        node={node}
        mode={FEEDBACK_MATRIX_MODE}
        theme={theme}
        sizePx={FEEDBACK_MATRIX_SIZE_PX}
        selectedHand={heroClass}
        onSelectHand={ignoreSelection}
      />
    </figure>
  );
}

export function FeedbackRangeView({ feedback }: FeedbackRangeViewProps) {
  const api = useAppApi();
  const query = useQuery(
    studyNodeByKeyQuery(api, { configId: feedback.config_id, pair: feedback.pair, nodeKey: feedback.node_key }),
  );
  if (query.isPending) return <LoadingNote text="Loading the range at this decision" />;
  if (query.isError) {
    return (
      <QueryFailure
        subject="The range at this decision"
        error={query.error}
        retryLabel="Retry the range"
        onRetry={() => void query.refetch()}
      />
    );
  }
  return <RangeBody node={query.data} heroClass={heroHandClass(feedback.hand)} />;
}
