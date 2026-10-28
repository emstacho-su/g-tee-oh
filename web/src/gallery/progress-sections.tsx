/**
 * Gallery sections for the S32 progress charts (R4.12, O-267, O-320): the track breakdown, the
 * leak-cost trend joined to the heat map, the mastery heat map, the holdout card with its
 * Goodhart flag, and the fresh learner's empty states, all from the synthetic fixtures
 * (src/fixtures/progress.ts). The charts take their drill click as a callback, so the gallery
 * needs no api or router: a click here only notes the class it would open. Each section carries
 * data-testid "gallery-<name>" for the shots project.
 */
import { useState } from "react";

import { HoldoutCard, LeakTrendChart, MasteryHeatMap, TrackBreakdown } from "../components/progress/index.js";
import {
  fixtureFreshHoldout,
  fixtureFreshLeaks,
  fixtureHeatmap,
  fixtureHoldout,
  fixtureLeaks,
  fixtureTracks,
} from "../fixtures/progress.js";
import type { DrillTarget } from "../progress/open-drill.js";
import { DEFAULT_LEAK_WEEKS, type LeakWeeks } from "../progress/types.js";
import { GallerySection } from "./sections.js";

const TRACK_NAMES = Object.fromEntries(fixtureTracks.map((track) => [track.track_key, track.name]));

function useClickNote() {
  const [note, setNote] = useState("Click a drill button or a cell to see the class it would open.");
  const onDrill = (target: DrillTarget) => setNote(`Would open the drill for ${target.spot.family} ${target.spot.pair} ${target.spot.format} ${target.spot.depthBand}.`);
  return { note, onDrill };
}

function LeakSection() {
  const [weeks, setWeeks] = useState<LeakWeeks>(DEFAULT_LEAK_WEEKS);
  const { note, onDrill } = useClickNote();
  return (
    <GallerySection name="leak-trend" title="Leak cost trend" note={note}>
      <LeakTrendChart leaks={fixtureLeaks} heatmap={fixtureHeatmap} weeks={weeks} onWeeksChange={setWeeks} onDrill={onDrill} />
    </GallerySection>
  );
}

function HeatMapSection() {
  const { note, onDrill } = useClickNote();
  return (
    <GallerySection name="mastery-heatmap" title="Mastery heat map" note={note}>
      <MasteryHeatMap heatmap={fixtureHeatmap} onDrill={onDrill} />
    </GallerySection>
  );
}

export function ProgressSections() {
  return (
    <>
      <GallerySection name="track-breakdown" title="Track breakdown" note="Rating per track on one shared axis; the weight 0 track says no coverage.">
        <TrackBreakdown tracks={fixtureTracks} />
      </GallerySection>
      <LeakSection />
      <HeatMapSection />
      <GallerySection name="holdout-card" title="Holdout card" note="The open round and the latest closed round per track, one with the Goodhart flag.">
        <HoldoutCard holdout={fixtureHoldout} trackNames={TRACK_NAMES} />
      </GallerySection>
      <GallerySection name="progress-empty" title="Progress empty states" note="A fresh learner: no leaks and no holdout round yet.">
        <div className="flex flex-col gap-4">
          <LeakTrendChart leaks={fixtureFreshLeaks} heatmap={fixtureHeatmap} weeks={DEFAULT_LEAK_WEEKS} onWeeksChange={() => undefined} onDrill={() => undefined} />
          <HoldoutCard holdout={fixtureFreshHoldout} />
        </div>
      </GallerySection>
    </>
  );
}
