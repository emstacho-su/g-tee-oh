/**
 * Sign-in page (R3.13, R0.7, A9 section 3). An email and password form with Radix labels. Client
 * checks run before anything is sent (email present and email-shaped, password present). Server
 * failures map to fixed messages: 401 says the credentials are wrong, 429 says to wait, anything
 * else is a generic failure. The server's detail text and the password are never shown. Messages
 * sit in a role="alert" element so screen readers announce them. On success the page goes to the
 * safe redirect target (safe-redirect.ts), so the redirect search value cannot send the user off
 * the app. The button is disabled while the request runs. When the session check before the page
 * failed for a reason other than 401 (router.tsx), a fixed "service unavailable" note shows above
 * the form, which still works.
 */
import { Label } from "@radix-ui/react-label";
import { useNavigate, useRouteContext, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";

import { HTTP_STATUS } from "../api/http-status.js";
import { isApiProblem } from "../api/index.js";
import { safeRedirect, useLogin } from "../auth/index.js";
import { Button } from "../components/ui/index.js";

export const LOGIN_MESSAGES = {
  emailMissing: "Enter your email address.",
  emailShape: "Enter an email address like name@example.com.",
  passwordMissing: "Enter your password.",
  incorrect: "Email or password is incorrect.",
  rateLimited: "Too many sign-in attempts. Wait a minute and try again.",
  generic: "Sign-in failed. Try again.",
  serviceUnavailable: "The service is unavailable right now. You can still try to sign in.",
} as const;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INPUT_CLASSES =
  "h-10 w-full rounded-md border border-border-strong bg-surface-sunken px-3 text-text focus-visible:outline-2 focus-visible:outline-offset-2";

/** The first client-side problem with the form, or null when it may be sent. */
export function checkCredentials(email: string, password: string): string | null {
  if (email === "") return LOGIN_MESSAGES.emailMissing;
  if (!EMAIL_SHAPE.test(email)) return LOGIN_MESSAGES.emailShape;
  if (password === "") return LOGIN_MESSAGES.passwordMissing;
  return null;
}

/** The fixed message for a failed sign-in; never the server's own text. */
export function loginFailureMessage(error: unknown): string {
  if (isApiProblem(error) && error.status === HTTP_STATUS.unauthorized) return LOGIN_MESSAGES.incorrect;
  if (isApiProblem(error) && error.status === HTTP_STATUS.tooManyRequests) return LOGIN_MESSAGES.rateLimited;
  return LOGIN_MESSAGES.generic;
}

export function LoginPage() {
  const { redirect } = useSearch({ from: "/login" });
  const sessionUnavailable = useRouteContext({ from: "/login", select: (context) => context.sessionUnavailable });
  const navigate = useNavigate();
  const loginMutation = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedEmail = email.trim();
    const problem = checkCredentials(trimmedEmail, password);
    setMessage(problem);
    if (problem !== null) return;
    try {
      await loginMutation.mutateAsync({ email: trimmedEmail, password });
    } catch (error: unknown) {
      setMessage(loginFailureMessage(error));
      return;
    }
    await navigate({ href: safeRedirect(redirect) });
  }

  return (
    <main className="mx-auto mt-16 max-w-sm space-y-4 rounded-lg border border-border bg-surface-raised p-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      {sessionUnavailable ? (
        <p role="status" className="rounded border border-warning px-3 py-2 text-sm text-warning">
          {LOGIN_MESSAGES.serviceUnavailable}
        </p>
      ) : null}
      <form noValidate className="space-y-3" onSubmit={(event) => void submit(event)}>
        <div className="space-y-1">
          <Label htmlFor="login-email" className="block text-sm font-medium">
            Email
          </Label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={INPUT_CLASSES}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="login-password" className="block text-sm font-medium">
            Password
          </Label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={INPUT_CLASSES}
          />
        </div>
        {message === null ? null : (
          <p role="alert" className="text-sm text-danger">
            {message}
          </p>
        )}
        <Button type="submit" variant="primary" className="w-full" disabled={loginMutation.isPending}>
          Sign in
        </Button>
      </form>
    </main>
  );
}
