/**
 * The drill session, /drills/$id/run: the trainer in spot mode (S25, R3.13, R3.11, A7 sections 2
 * to 4). SCAFFOLD: Lane B builds the screen; the route, its id and its validated seed are wired.
 */
export interface DrillRunPageProps {
  drillId: string;
  seed?: string;
}

export function DrillRunPage({ drillId }: DrillRunPageProps) {
  return (
    <section className="space-y-2" data-drill-id={drillId}>
      <h1 className="text-2xl font-semibold">Drill session</h1>
    </section>
  );
}
