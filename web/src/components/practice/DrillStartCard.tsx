/**
 * The start card an old drill link shows on /quiz and /paint (S41, R3.16, R3.17, PR #39 security
 * LOW 2): a link never starts a session on mount, so a drill link names what will start (a
 * drill-backed quiz or painting session) and waits for the player's Start.
 */
import { Button, Card } from "../ui/index.js";

export interface DrillStartCardProps {
  title: string;
  body: string;
  startLabel: string;
  onStart: () => void;
}

export function DrillStartCard({ title, body, startLabel, onStart }: DrillStartCardProps) {
  return (
    <Card title={title} testId="drill-start-card" className="max-w-xl">
      <p className="text-sm">{body}</p>
      <div>
        <Button variant="primary" size="lg" onClick={onStart}>
          {startLabel}
        </Button>
      </div>
    </Card>
  );
}
