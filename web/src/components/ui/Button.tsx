/**
 * The app's button (S24, O-44). A plain <button> styled with the semantic Tailwind tokens; the
 * Radix Slot lets a caller render a link with the same look through asChild. type defaults to
 * "button" so a button inside a form never submits it by accident.
 */
import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "./cn.js";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
}

const VARIANT_CLASSES: Readonly<Record<ButtonVariant, string>> = {
  primary: "bg-accent text-accent-text hover:opacity-90",
  secondary: "border border-border bg-surface-raised text-text hover:bg-surface-sunken",
  ghost: "text-text hover:bg-surface-sunken",
  danger: "bg-danger text-white hover:opacity-90",
};

const SIZE_CLASSES: Readonly<Record<ButtonSize, string>> = {
  sm: "h-8 px-2 text-sm",
  md: "h-10 px-3 text-sm",
  lg: "h-12 px-4 text-base",
};

export function Button({ variant = "secondary", size = "md", asChild = false, className, type, ...rest }: ButtonProps) {
  const classes = cn(
    "inline-flex items-center justify-center gap-1 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className,
  );
  if (asChild) return <Slot className={classes} {...rest} />;
  return <button type={type ?? "button"} className={classes} {...rest} />;
}
