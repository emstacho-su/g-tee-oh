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
import { useRef } from "react";

import type { AppApi } from "../api/index.js";
import { useIntentMutation, type IntentMutation } from "../library/use-intent-mutation.js";
import { drillQuery } from "../trainer/session-api.js";
import { createDrill, deleteDrill, duplicateDrill, importDrill, invalidateDrills, patchDrill } from "./queries.js";
import { STARTER_PACK, type StarterDrill } from "./starter-pack.js";
import type { Drill, DrillCreate, DrillPatch } from "./types.js";

export type SaveInput = { readonly kind: "create"; readonly body: DrillCreate } | { readonly kind: "patch"; readonly id: string; readonly body: DrillPatch };

function useInvalidate(): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => invalidateDrills(queryClient);
}

export function useSaveDrill(api: AppApi, onSaved: (drill: Drill, input: SaveInput) => void): IntentMutation<SaveInput, Drill> {
  const invalidate = useInvalidate();
  const queryClient = useQueryClient();
  return useIntentMutation<SaveInput, Drill>({
    run: (input, key) => (input.kind === "create" ? createDrill(api, input.body, key) : patchDrill(api, input.id, input.body, key)),
    onSuccess: async (drill, input) => {
      await invalidate();
      // The run screen reads the drill under its own key; the saved answer is that drill now, so a
      // Save and run never starts on the cached copy (PR #48 review round 2 HIGH 1).
      queryClient.setQueryData(drillQuery(api, drill.id).queryKey, drill);
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

/** The Idempotency-Key of one starter code: a base key and the code's place in the whole pack. */
export function starterImportKey(baseKey: string, packIndex: number): string {
  return `${baseKey}-${packIndex}`;
}

/**
 * The starter pack as one intent (S47, R3.35, O-481): one derived key per code, so a double click
 * sends nothing twice and a retry resends the same key for the same code, which the api replays
 * for a code that landed. The input is the codes still missing (missingStarterDrills): after a
 * failure partway, the drill reads are invalidated so the codes that landed show, and the next
 * click sends only what is still missing (PR #48 review round 2 MEDIUM 3). A code keeps the key it
 * was first sent under until that code lands, whatever the input around it, so a retry of a code
 * whose answer was lost replays instead of importing it twice; once it lands its key is dropped,
 * so re-adding a starter drill the user deleted later mints a fresh key and creates it again
 * (round 3 HIGH: a kept key made the api replay the first 201 and create nothing).
 */
export function useImportStarterPack(api: AppApi, onImported: (drills: readonly Drill[]) => void): IntentMutation<readonly StarterDrill[], Drill[]> {
  const invalidate = useInvalidate();
  const codeKeys = useRef<ReadonlyMap<string, string>>(new Map());
  const keyFor = (entry: StarterDrill, baseKey: string): string => {
    const known = codeKeys.current.get(entry.key);
    if (known !== undefined) return known;
    const key = starterImportKey(baseKey, STARTER_PACK.findIndex((each) => each.key === entry.key));
    codeKeys.current = new Map([...codeKeys.current, [entry.key, key]]);
    return key;
  };
  return useIntentMutation<readonly StarterDrill[], Drill[]>({
    run: async (pack, key) => {
      const imported: Drill[] = [];
      for (const entry of pack) {
        imported.push(await importDrill(api, entry.code, keyFor(entry, key)));
        codeKeys.current = new Map([...codeKeys.current].filter(([codeKey]) => codeKey !== entry.key));
      }
      return imported;
    },
    onSuccess: async (drills) => {
      await invalidate();
      onImported(drills);
    },
    // The codes that landed before the failure are in the library: show them (review MEDIUM 3).
    onError: () => {
      void invalidate();
    },
  });
}
