/**
 * Gallery section for the feedback panel with every section expanded (S38, R3.13, O-267, O-387,
 * O-388). The collapsed panel, as a decision first shows it, stays in sections.tsx
 * (gallery-feedback-panel); this one opens Roll, Strategy, Range, Where your hand sits, Insights
 * and Explanation at once, all from the synthetic fixtures with no api request
 * (feedback-gallery-parts.tsx).
 */
import { ThresholdCard } from "../components/panels/index.js";
import { FeedbackPanel, FeedbackRoller, type FeedbackOpenState } from "../components/trainer/index.js";
import { fixtureActions, fixtureFeedback, fixtureInsights } from "../fixtures/index.js";
import { GALLERY_HERO_CLASS, GalleryExplanationBody, GalleryInsightsBody, GalleryRangeBody } from "./feedback-gallery-parts.js";
import { GallerySection } from "./sections.js";

const noop = (): void => undefined;
/** The hero called (fixture feedback): roll 37 fell on the raise, so the roll was not followed. */
const CHOSEN_INDEX = 1;

const ALL_OPEN: FeedbackOpenState = { roll: true, strategy: true, range: true, threshold: true, insights: true, explanation: true };

export function FeedbackGallerySections() {
  return (
    <GallerySection
      name="feedback-expanded"
      title="FeedbackPanel, every section expanded"
      note="The summary, then each section opened inline: the roll with its mark, the strategy, the range, where the hand sits, the insights and the explanation (O-387, O-388)."
    >
      <FeedbackPanel
        feedback={fixtureFeedback}
        actions={fixtureActions}
        chosenIndex={CHOSEN_INDEX}
        roller={
          <FeedbackRoller
            feedback={fixtureFeedback}
            actions={fixtureActions}
            chosenIndex={CHOSEN_INDEX}
            grouping="standard"
            street="preflop"
            onExplain={noop}
          />
        }
        rangeView={<GalleryRangeBody />}
        thresholdCard={<ThresholdCard card={fixtureInsights.threshold_card} heroHand={GALLERY_HERO_CLASS} />}
        insights={<GalleryInsightsBody />}
        explanation={<GalleryExplanationBody />}
        explain={<></>}
        defaultOpen={ALL_OPEN}
      />
    </GallerySection>
  );
}
