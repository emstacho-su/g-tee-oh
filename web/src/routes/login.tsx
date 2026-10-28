/**
 * Two-step sign-in (S42, R3.13, O-349, O-425; S24 R0.7 before it). Step 1 asks for the email and
 * only checks its shape in the browser: no request is sent, so this step can never reveal whether
 * an account exists. Step 2 shows the email as a read-only chip with "Use a different email", asks
 * for the password (show and hide) and sends the one POST /auth/login. A 401 shows the same fixed
 * text whether the email is unknown or the password wrong (the api answers both alike, in the same
 * time), clears the password and focuses it; 429 says to wait; anything else is generic. The
 * server's detail text and the password are never shown. Messages sit in role="alert". On success
 * the short redirecting state shows, then the page goes to the safe redirect target
 * (safe-redirect.ts). When the session check before the page failed for a reason other than 401
 * (router.tsx), a fixed "service unavailable" note shows above step 1, which still works.
 */
import { Label } from "@radix-ui/react-label";
import { useNavigate, useRouteContext, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { HTTP_STATUS } from "../api/http-status.js";
import { isApiProblem } from "../api/index.js";
import { EMAIL_SHAPE } from "../auth/account-rules.js";
import { safeRedirect, useLogin } from "../auth/index.js";
import { Button, cn, FIELD_CLASS } from "../components/ui/index.js";
import { AuthShell, EmailChip, Spinner } from "./onboarding/AuthShell.js";
import { SIGN_IN_TEXT } from "./onboarding/onboarding-text.js";
import { PasswordField } from "./onboarding/PasswordField.js";
import { finishWithRedirect, RedirectingState } from "./onboarding/RedirectingState.js";

/** The fixed sign-in texts; kept under this name for the screens and tests that read it. */
export const LOGIN_MESSAGES = SIGN_IN_TEXT;

const EMAIL_ID = "login-email";
const PASSWORD_ID = "login-password";
const MESSAGE_ID = "login-message";

type Step = "email" | "password" | "redirecting";

/** The first client-side problem with the email, or null when step 2 may open. */
export function checkEmail(email: string): string | null {
  if (email === "") return SIGN_IN_TEXT.emailMissing;
  if (!EMAIL_SHAPE.test(email)) return SIGN_IN_TEXT.emailShape;
  return null;
}

/** The first client-side problem with the whole form, or null when it may be sent. */
export function checkCredentials(email: string, password: string): string | null {
  return checkEmail(email) ?? (password === "" ? SIGN_IN_TEXT.passwordMissing : null);
}

/** The fixed message for a failed sign-in; never the server's own text. */
export function loginFailureMessage(error: unknown): string {
  if (isApiProblem(error) && error.status === HTTP_STATUS.unauthorized) return SIGN_IN_TEXT.incorrect;
  if (isApiProblem(error) && error.status === HTTP_STATUS.tooManyRequests) return SIGN_IN_TEXT.rateLimited;
  return SIGN_IN_TEXT.generic;
}

function FormMessage({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p id={MESSAGE_ID} role="alert" className="text-sm text-danger">
      {message}
    </p>
  );
}

interface EmailStepProps {
  email: string;
  onEmail: (value: string) => void;
  message: string | null;
  onContinue: () => void;
}

function EmailStep({ email, onEmail, message, onContinue }: EmailStepProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onContinue();
  }
  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={submit}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={EMAIL_ID} className="text-sm font-medium">
          Email
        </Label>
        <input
          id={EMAIL_ID}
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          value={email}
          aria-invalid={message !== null}
          aria-describedby={message === null ? undefined : MESSAGE_ID}
          onChange={(event) => onEmail(event.target.value)}
          className={cn(FIELD_CLASS, "h-11 w-full px-3")}
        />
      </div>
      <FormMessage message={message} />
      <Button type="submit" variant="primary" size="lg" className="w-full">
        {SIGN_IN_TEXT.continue}
      </Button>
    </form>
  );
}

interface PasswordStepProps {
  email: string;
  message: string | null;
  pending: boolean;
  onSubmit: (password: string) => Promise<boolean>;
  onBack: () => void;
}

function PasswordStep({ email, message, pending, onSubmit, onBack }: PasswordStepProps) {
  const [password, setPassword] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    passwordRef.current?.focus();
  }, [message]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accepted = await onSubmit(password);
    if (!accepted) setPassword("");
  }

  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      {/* The username field lets a password manager pair the saved login with this email. */}
      <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
      <PasswordField
        ref={passwordRef}
        id={PASSWORD_ID}
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
        invalid={message !== null}
        describedBy={message === null ? undefined : MESSAGE_ID}
      />
      <FormMessage message={message} />
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
        {pending ? <Spinner /> : null}
        {SIGN_IN_TEXT.signIn}
      </Button>
      <Button variant="ghost" className="w-full" onClick={onBack} disabled={pending}>
        {SIGN_IN_TEXT.useDifferentEmail}
      </Button>
    </form>
  );
}

export function LoginPage() {
  const { redirect } = useSearch({ from: "/login" });
  const sessionUnavailable = useRouteContext({ from: "/login", select: (context) => context.sessionUnavailable });
  const navigate = useNavigate();
  const loginMutation = useLogin();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  function continueToPassword() {
    const trimmed = email.trim();
    const problem = checkEmail(trimmed);
    setMessage(problem);
    if (problem !== null) return;
    setEmail(trimmed);
    setStep("password");
  }

  async function signIn(password: string): Promise<boolean> {
    const problem = checkCredentials(email, password);
    setMessage(problem);
    if (problem !== null) return false;
    try {
      await loginMutation.mutateAsync({ email, password });
    } catch (error: unknown) {
      setMessage(loginFailureMessage(error));
      return false;
    }
    setStep("redirecting");
    await finishWithRedirect(() => navigate({ href: safeRedirect(redirect) }));
    return true;
  }

  function backToEmail() {
    setMessage(null);
    setStep("email");
  }

  if (step === "redirecting") return <RedirectingState title={SIGN_IN_TEXT.redirecting} />;

  return (
    <AuthShell title={SIGN_IN_TEXT.title} subtitle={step === "password" ? <EmailChip email={email} /> : null}>
      {sessionUnavailable ? (
        <p role="status" className="rounded-lg border border-warning px-3 py-2 text-sm text-warning">
          {SIGN_IN_TEXT.serviceUnavailable}
        </p>
      ) : null}
      {step === "email" ? (
        <EmailStep email={email} onEmail={setEmail} message={message} onContinue={continueToPassword} />
      ) : (
        <PasswordStep
          email={email}
          message={message}
          pending={loginMutation.isPending}
          onSubmit={signIn}
          onBack={backToEmail}
        />
      )}
    </AuthShell>
  );
}
