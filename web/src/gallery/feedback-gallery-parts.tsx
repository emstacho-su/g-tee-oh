/**
 * The feedback panel's section bodies for the gallery (S38, R3.13, O-267, O-387), built from the
 * synthetic fixtures with no api request, shared by the collapsed panel (sections.tsx) and the
 * expanded one (feedback-sections.tsx): the range at the decision from the fixture study node, the
 * noise flags card alone (drift reads the api), and the fixture More info drawn without its read.
 */
import { MoreInfoSections } from "../components/explain/MoreInfoSection.js";
import { NoiseFlagsCard } from "../components/insights/NoiseFlagsCard.js";
import { RangeMatrix } from "../components/range-matrix/RangeMatrix.js";
import { fixtureMoreInfo } from "../fixtures/explain.js";
import { fixtureFeedback, fixtureStudyNode } from "../fixtures/index.js";
import { useThemeStore } from "../store/index.js";

const noop = (): void => undefined;
export const GALLERY_HERO_CLASS = "AJo";
/** The feedback panel's matrix size (FeedbackRangeView). */
const MATRIX_SIZE_PX = 390;

export function GalleryRangeBody() {
  const theme = useThemeStore((state) => state.theme);
  return (
    <RangeMatrix node={fixtureStudyNode} mode="frequency" theme={theme} sizePx={MATRIX_SIZE_PX} selectedHand={GALLERY_HERO_CLASS} onSelectHand={noop} />
  );
}

export function GalleryInsightsBody() {
  return <NoiseFlagsCard flags={fixtureFeedback.noise_flags} />;
}

export function GalleryExplanationBody() {
  return <MoreInfoSections sections={fixtureMoreInfo.sections} />;
}
