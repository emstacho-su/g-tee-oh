/**
 * Applies the equipped cosmetics across the signed-in app (S32, R4.14, O-323, ADR 0012). Mounted
 * once in AuthLayout; it renders nothing.
 *
 * Mechanism: it reads the cosmetics store and, only when some slot has a choice, the streak read
 * (GET /progress/streak), whose unlocks the server owns. The effective items are the choices that
 * are unlocked now (effectiveCosmetics); a felt or card back among them is written as data-felt or
 * data-card-back on <html>, which styles.css turns into the felt and card back custom properties.
 * While the read loads, when it fails, when no item is effective, when the user signs out (the
 * layout unmounts) or on unmount, the attributes are removed, so the app shows its standard look.
 * The badge has no global style; the home rating card shows it.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { useAppApi } from "../auth/index.js";
import { streakQuery } from "../progress/queries.js";
import { effectiveCosmetics, hasAnyChoice, NO_COSMETICS, useCosmeticsStore, type CosmeticChoices } from "../store/index.js";

export const FELT_ATTRIBUTE = "data-felt";
export const CARD_BACK_ATTRIBUTE = "data-card-back";

export interface CosmeticsRootProps {
  /** The element that carries the attributes; <html> by default. For tests. */
  root?: HTMLElement;
}

function setOrRemove(root: HTMLElement, attribute: string, value: string | null): void {
  if (value === null) root.removeAttribute(attribute);
  else root.setAttribute(attribute, value);
}

/** The effective choices for the signed-in user: none until the unlocks are known. */
export function useEffectiveCosmetics(): CosmeticChoices {
  const choices = useCosmeticsStore((state) => state.choices);
  const streak = useQuery({ ...streakQuery(useAppApi()), enabled: hasAnyChoice(choices) });
  const unlocks = streak.data?.unlocks;
  return useMemo(() => {
    if (unlocks === undefined) return NO_COSMETICS;
    return effectiveCosmetics(choices, new Set(unlocks.map((unlock) => unlock.cosmetic_key)));
  }, [choices, unlocks]);
}

export function CosmeticsRoot({ root }: CosmeticsRootProps) {
  const effective = useEffectiveCosmetics();
  const felt = effective.felt;
  const cardBack = effective["card-back"];
  useEffect(() => {
    const target = root ?? document.documentElement;
    setOrRemove(target, FELT_ATTRIBUTE, felt);
    setOrRemove(target, CARD_BACK_ATTRIBUTE, cardBack);
    return () => {
      target.removeAttribute(FELT_ATTRIBUTE);
      target.removeAttribute(CARD_BACK_ATTRIBUTE);
    };
  }, [root, felt, cardBack]);
  return null;
}
