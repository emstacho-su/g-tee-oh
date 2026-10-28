/**
 * A labelled password input with a show and hide toggle (S42, R3.13), shared by sign-in and join.
 * The input uses FIELD_CLASS, the S36 control edge; the toggle is a ghost Button inside the field
 * whose accessible name says what it will do. Showing the password never sends it anywhere.
 */
import { Label } from "@radix-ui/react-label";
import { forwardRef, useState, type ReactNode } from "react";

import { Button, cn, FIELD_CLASS } from "../../components/ui/index.js";
import { PASSWORD_TEXT } from "./onboarding-text.js";

export interface PasswordFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  invalid?: boolean;
  /** The id of the text that describes the field (an error or the strength meter). */
  describedBy?: string | undefined;
  /** Rendered under the input, such as the strength meter. */
  children?: ReactNode;
}

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField(
  { id, value, onChange, autoComplete, invalid = false, describedBy, children },
  ref,
) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {PASSWORD_TEXT.label}
      </Label>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          name="password"
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
          className={cn(FIELD_CLASS, "h-11 w-full px-3 pr-16")}
        />
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-1/2 right-1.5 -translate-y-1/2 text-xs"
          aria-pressed={visible}
          onClick={() => setVisible((shown) => !shown)}
        >
          {visible ? PASSWORD_TEXT.hide : PASSWORD_TEXT.show}
        </Button>
      </div>
      {children}
    </div>
  );
});
