/**
 * The Home "Your spots" card (S45, R3.27, O-460, design rule 5): the starred and the recent study
 * spots of this browser as one-click links into Study, each list with a one-line empty state. It
 * reads only the per-browser store, never the network, so Home makes no extra request; the stake
 * part of each label is left out here because the stakes are not loaded on Home.
 */
import { Card } from "../../components/ui/index.js";
import { SPOT_TEXT, SpotShortcuts } from "../study/SpotShortcuts.js";

const NO_STAKES = [] as const;

export function SpotsCard() {
  return (
    <Card title={SPOT_TEXT.cardTitle}>
      <SpotShortcuts stakes={NO_STAKES} />
    </Card>
  );
}
