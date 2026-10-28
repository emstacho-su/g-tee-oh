/**
 * The app's button (S24, O-44; S36, O-346). A plain <button> styled with the semantic Tailwind
 * tokens; the Radix Slot lets a caller render a link with the same look through asChild. type
 * defaults to "button" so a button inside a form never submits it by accident.
 *
 * Every variant carries the shared tactile press (styles.css): soft layered depth at rest, a 1 px
 * lift on hover, a squish while pressed and a spring back on release, with no movement under
 * reduced motion. The ghost variant drops only the resting shadow.
 */
import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "./cn.js";
import { FLAT_REST_CLASS, TACTILE_CLASS } from "./tactile.js";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
}

const VARIANT_CLASSES: Readonly<Record<ButtonVariant, string>> = {
  primary: "bg-accent text-accent-text",
  secondary: "border border-border/70 bg-surface-raised text-text hover:bg-surface",
  ghost: cn("text-text hover:bg-surface-sunken", FLAT_REST_CLASS),
  danger: "bg-danger text-accent-text",
};

const SIZE_CLASSES: Readonly<Record<ButtonSize, string>> = {
  sm: "h-8 rounded-lg px-3 text-sm",
  md: "h-10 rounded-xl px-4 text-sm",
  lg: "h-12 rounded-xl px-5 text-base",
};

export function Button({ variant = "secondary", size = "md", asChild = false, className, type, ...rest }: ButtonProps) {
  const classes = cn(
    "inline-flex select-none items-center justify-center gap-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-50",
    TACTILE_CLASS,
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className,
  );
  if (asChild) return <Slot className={classes} {...rest} />;
  return <button type={type ?? "button"} className={classes} {...rest} />;
}
