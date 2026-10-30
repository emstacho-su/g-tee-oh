/**
 * The Home "Your spots" card (S45, R3.27, O-460, design rule 5): the starred and the recent study
 * spots of this browser as one-click links into Study, each list with a one-line empty state. The
 * spots come from the per-browser store; the stakes read (the catalog read Study already makes, so
 * usually a cache hit) names each spot's stake, and a stake it cannot name prints by its id, so two
 * spots that differ only by stake never read the same (code review). A failed stakes read leaves the
 * ids in place and shows no error: the links still work.
 */
import { useQuery } from "@tanstack/react-query";

import { useAppApi } from "../../auth/index.js";
import { Card } from "../../components/ui/index.js";
import { stakesQuery } from "../../study/queries.js";
import { SPOT_TEXT, SpotShortcuts } from "../study/SpotShortcuts.js";

export function SpotsCard() {
  const stakes = useQuery(stakesQuery(useAppApi()));
  return (
    <Card title={SPOT_TEXT.cardTitle}>
      <SpotShortcuts stakes={stakes.data ?? []} />
    </Card>
  );
}
