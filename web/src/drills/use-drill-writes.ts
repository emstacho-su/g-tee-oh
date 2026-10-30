/**
 * The drill screens' writes as intent mutations (S26, R3.14, O-232, O-311): save (create or
 * patch), duplicate, delete and import. Each is one useIntentMutation (library/use-intent-
 * mutation.ts): the Idempotency-Key is minted when the user acts, a double click sends one
 * request, a retry of the same input after a failure reuses the key, and a success drops it, so
 * the next click is a new intent (a second Duplicate makes a second copy). Every success
 * invalidates the drill reads (queries.ts invalidateDrills). A list row owns its own duplicate and
 * delete mutations, so one row's request never blocks another's.
 */
import { useQueryClient } from "@tanstack/react-query";

import type { AppApi } from "../api/index.js";
import { useIntentMutation, type IntentMutation } from "../library/use-intent-mutation.js";
import { createDrill, deleteDrill, duplicateDrill, importDrill, invalidateDrills, patchDrill } from "./queries.js";
import type { StarterDrill } from "./starter-pack.js";
import type { Drill, DrillCreate, DrillPatch } from "./types.js";

export type SaveInput = { readonly kind: "create"; readonly body: DrillCreate } | { readonly kind: "patch"; readonly id: string; readonly body: DrillPatch };

function useInvalidate(): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => invalidateDrills(queryClient);
}

export function useSaveDrill(api: AppApi, onSaved: (drill: Drill, input: SaveInput) => void): IntentMutation<SaveInput, Drill> {
  const invalidate = useInvalidate();
  return useIntentMutation<SaveInput, Drill>({
    run: (input, key) => (input.kind === "create" ? createDrill(api, input.body, key) : patchDrill(api, input.id, input.body, key)),
    onSuccess: async (drill, input) => {
      await invalidate();
      onSaved(drill, input);
    },
  });
}

export function useDuplicateDrill(api: AppApi, onDuplicated?: (copy: Drill) => void): IntentMutation<string, Drill> {
  const invalidate = useInvalidate();
  return useIntentMutation<string, Drill>({
    run: (id, key) => duplicateDrill(api, id, key),
    onSuccess: async (copy) => {
      await invalidate();
      onDuplicated?.(copy);
    },
  });
}

export function useDeleteDrill(api: AppApi): IntentMutation<string, void> {
  const invalidate = useInvalidate();
  return useIntentMutation<string, void>({
    run: (id, key) => deleteDrill(api, id, key),
    onSuccess: () => invalidate(),
  });
}

export function useImportDrill(api: AppApi, onImported: (drill: Drill) => void): IntentMutation<string, Drill> {
  const invalidate = useInvalidate();
  return useIntentMutation<string, Drill>({
    run: (code, key) => importDrill(api, code, key),
    onSuccess: async (drill) => {
      await invalidate();
      onImported(drill);
    },
  });
}

/** The Idempotency-Key of one code of a pack: the click's base key and the code's place in the pack. */
export function starterImportKey(baseKey: string, index: number): string {
  return `${baseKey}-${index}`;
}

/**
 * The starter pack as one intent (S47, R3.35, O-481): one base key per click, one derived key per
 * code, so a double click sends nothing twice and a retry after a failure resends the same keys,
 * which the api replays for the codes that landed. The codes import one after another, so a
 * failure stops the run where it is and Try again picks the whole pack up again under the same keys.
 */
export function useImportStarterPack(api: AppApi, onImported: (drills: readonly Drill[]) => void): IntentMutation<readonly StarterDrill[], Drill[]> {
  const invalidate = useInvalidate();
  return useIntentMutation<readonly StarterDrill[], Drill[]>({
    run: async (pack, key) => {
      const imported: Drill[] = [];
      for (const [index, entry] of pack.entries()) {
        imported.push(await importDrill(api, entry.code, starterImportKey(key, index)));
      }
      return imported;
    },
    onSuccess: async (drills) => {
      await invalidate();
      onImported(drills);
    },
  });
}
