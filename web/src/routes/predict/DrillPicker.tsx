/**
 * The /predict drill picker (S27 lane A, R3.16, O-302): the user's drills from GET /drills, each a
 * link to /predict?drill=<id>, which starts a prediction session over that drill's spots. With no
 * drill the empty state says to create one in Drills. A failed read shows fixed text by problem
 * kind, never the server's detail.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { useAppApi } from "../../auth/index.js";
import { LoadingNote } from "../../components/ui/index.js";
import { drillListQuery } from "../../prediction/api.js";
import { PREDICTION_TEXT, problemText } from "../../prediction/labels.js";

export function DrillPicker() {
  const api = useAppApi();
  const drills = useQuery(drillListQuery(api));
  return (
    <section aria-labelledby="predict-picker" className="flex flex-col gap-3">
      <h2 id="predict-picker" className="text-lg font-semibold">
        {PREDICTION_TEXT.pickerHeading}
      </h2>
      {drills.isPending ? <LoadingNote text={PREDICTION_TEXT.pickerLoading} /> : null}
      {drills.isError ? (
        <p role="alert" className="text-danger">
          {problemText(drills.error)}
        </p>
      ) : null}
      {drills.data?.length === 0 ? (
        <p>
          {PREDICTION_TEXT.pickerEmpty}{" "}
          <Link to="/drills" className="underline">
            Open Drills
          </Link>
        </p>
      ) : null}
      {drills.data === undefined || drills.data.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {drills.data.map((drill) => (
            <li key={drill.id}>
              <Link to="/predict" search={{ drill: drill.id }} className="block rounded-md border border-border bg-surface-raised px-3 py-2 hover:bg-surface-sunken">
                {drill.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
