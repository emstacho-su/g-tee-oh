/**
 * Gallery sections for the Mixed-frequency mode and feedback components (S25, S37, R3.10, R3.13,
 * O-267, O-283, O-344, O-378): the explainer text inline (plus a button and the I key that open the
 * real dialog), the roll scale hidden as it stands before a decision, and the feedback panel wired
 * with the revealed scale and its followed-the-roll mark, the range view and the threshold card as
 * the trainer shows it after a decision.
 *
 * Mechanism: the range view and the threshold card read through TanStack Query. The gallery has
 * no api, so a private QueryClient is seeded with the synthetic fixtures under the exact keys the
 * shared query factories use; the reads are fresh for STUDY_STALE_MS, so nothing is fetched, and
 * the api handed to ApiProvider refuses any request loudly if one ever is. Each section carries
 * data-testid "gallery-<name>" for the shots project.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { createAppApi } from "../api/index.js";
import { ApiProvider } from "../auth/index.js";
import { Button } from "../components/ui/index.js";
import {
  FeedbackPanel,
  FeedbackRangeView,
  FeedbackRoller,
  FeedbackThreshold,
  RngExplainer,
  RngRoller,
  useRngExplainer,
} from "../components/trainer/index.js";
import { RngExplainerContent } from "../components/trainer/RngExplainer.js";
import { fixtureActions, fixtureFeedback, fixtureInsights, fixtureStudyNode } from "../fixtures/index.js";
import { studyInsightsQuery, studyNodeByKeyQuery } from "../study/queries.js";
import { GallerySection } from "./sections.js";

/** The hero called; roll 37 fell on the raise, so the roll was not followed (fixture feedback, O-371). */
const CHOSEN_INDEX = 1;
/** The roll the hidden scale shows before a decision; the same roll as the fixture feedback. */
const SCALE_ROLL = 37;

const galleryApi = createAppApi({
  baseUrl: "http://gallery.invalid",
  fetch: () => Promise.reject(new TypeError("the component gallery has no api; seed the query cache instead")),
});

function seededQueryClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const nodeOptions = studyNodeByKeyQuery(galleryApi, {
    configId: fixtureFeedback.config_id,
    pair: fixtureFeedback.pair,
    nodeKey: fixtureFeedback.node_key,
  });
  const insightsOptions = studyInsightsQuery(galleryApi, {
    solutionId: fixtureFeedback.solution_id,
    nodeKey: fixtureFeedback.node_key,
    hand: fixtureFeedback.hand,
  });
  client.setQueryData(nodeOptions.queryKey, fixtureStudyNode);
  client.setQueryData(insightsOptions.queryKey, fixtureInsights);
  return client;
}

function ExplainerSection() {
  const explainer = useRngExplainer();
  return (
    <GallerySection
      name="rng-explainer"
      title="RngExplainer"
      note="What earns Best, how the roll works, why practise mixing (05 section 7, ADR 0024). The button or the I key opens the dialog."
    >
      <div className="flex flex-col gap-3">
        <RngExplainerContent />
        <Button onClick={() => explainer.setOpen(true)}>Open the explainer dialog</Button>
      </div>
      <RngExplainer open={explainer.open} onOpenChange={explainer.setOpen} />
    </GallerySection>
  );
}

function WiredFeedbackSection() {
  const [queryClient] = useState(seededQueryClient);
  const explainer = useRngExplainer({ hotkey: false });
  return (
    <GallerySection
      name="feedback-wired"
      title="FeedbackPanel, wired"
      note="After the decision: the same scale with the bands revealed and the followed-the-roll mark (never Best), the range view with the hero's class, the threshold card (O-281, O-371)."
    >
      <QueryClientProvider client={queryClient}>
        <ApiProvider api={galleryApi}>
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
                onExplain={() => explainer.setOpen(true)}
              />
            }
            rangeView={<FeedbackRangeView feedback={fixtureFeedback} />}
            thresholdCard={<FeedbackThreshold feedback={fixtureFeedback} />}
            // The wired view shows the seeded range and threshold reads, so both sections start open (S38, O-387).
            defaultOpen={{ range: true, threshold: true }}
          />
        </ApiProvider>
      </QueryClientProvider>
      <RngExplainer open={explainer.open} onOpenChange={explainer.setOpen} />
    </GallerySection>
  );
}

export function RngSections() {
  return (
    <>
      <ExplainerSection />
      <GallerySection
        name="roll-scale"
        title="RngRoller, hidden"
        note="Before the decision: the roll on the 1 to 100 scale and the info button, never the bands (ADR 0024 rule 3, O-344)."
      >
        <RngRoller hidden roll={SCALE_ROLL} onExplain={() => undefined} />
      </GallerySection>
      <WiredFeedbackSection />
    </>
  );
}
