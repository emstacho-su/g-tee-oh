/**
 * The line breadcrumb (S25, R3.12, O-286): Root, then one step per action token of the URL's line.
 * Every earlier step is a link to its own /study URL (a push, so browser back walks the same
 * path), the current step is plain text marked aria-current, and a click marks a node switch
 * request (O-287). Built from the URL alone, so it shows while the node is still loading.
 */
import { Link } from "@tanstack/react-router";

import { withLine } from "../../study/filters.js";
import { breadcrumbSteps } from "../../study/line.js";
import { useNodeSwitchMetrics } from "../../study/node-switch-metrics.js";
import type { StudySearch } from "../../study/search.js";

export interface LineBreadcrumbProps {
  search: StudySearch;
}

export function LineBreadcrumb({ search }: LineBreadcrumbProps) {
  const metrics = useNodeSwitchMetrics();
  const steps = breadcrumbSteps(search.line);
  const last = steps.length - 1;
  return (
    <nav aria-label="Line" className="text-sm">
      <ol className="flex flex-wrap items-center gap-1">
        {steps.map((step, position) => (
          <li key={step.line} className="flex items-center gap-1">
            {position > 0 ? <span aria-hidden="true" className="text-muted">/</span> : null}
            {position === last ? (
              <span aria-current="page" className="font-semibold">
                {step.label}
              </span>
            ) : (
              <Link
                to="/study"
                search={withLine(search, step.line)}
                onClick={() => metrics.markRequest()}
                className="text-accent underline-offset-2 hover:underline"
              >
                {step.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
