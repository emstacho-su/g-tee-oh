/**
 * Join by invite (S42, R3.13, O-349, O-421, O-422, O-424, O-425). The link is /join#<token>.
 *
 * Mechanism: the token is read from the URL fragment into component state, and the fragment is then
 * removed from the address bar (a replace navigation), so it is not left in the history or shown
 * on screen; the fragment never reaches a server, a log or a Referer header. A second link opened
 * on /join in the same tab replaces the token, and the flow is keyed on it, so it starts over for
 * the new invite (review round 1, H). The token lives
 * only in this component's state and in request bodies, never in a query key or storage. The page
 * asks the api once whether the invite is usable (inspect): while that runs it says so; any bad
 * token gets one fixed message with a way to sign in (O-422). The invite fixes the email (O-421),
 * so the form shows it as a read-only chip and asks only a name and a password, with the live
 * strength meter (O-424, advisory: only the 12-character minimum blocks). The name gets the same
 * checks the api applies (auth/account-rules.ts mirrors them: trimmed, 1 to 60 characters, at least
 * one letter or digit, no control, invisible or default-ignorable characters). On success the redirecting state shows, then home. Every failure maps to a fixed
 * text by status; the server's detail, the token and the password are never shown.
 */
import { Label } from "@radix-ui/react-label";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { HTTP_STATUS } from "../api/http-status.js";
import { isApiProblem } from "../api/index.js";
import { MAX_RAW_NAME_LENGTH, meetsPasswordMinimum, nameProblem, type NameProblem } from "../auth/account-rules.js";
import { inspectInvite, useAppApi, useJoin } from "../auth/index.js";
import { Button, cn, FIELD_CLASS } from "../components/ui/index.js";
import type { InvitePreview } from "../contracts.js";
import { AuthShell, EmailChip, Spinner } from "./onboarding/AuthShell.js";
import { JOIN_TEXT } from "./onboarding/onboarding-text.js";
import { PasswordField } from "./onboarding/PasswordField.js";
import { finishWithRedirect, RedirectingState } from "./onboarding/RedirectingState.js";
import { StrengthMeter } from "./onboarding/StrengthMeter.js";
import { strengthInputs } from "./onboarding/strength.js";

const HOME_PATH = "/";
const NAME_PROBLEM_TEXT: Readonly<Record<NameProblem, string>> = {
  empty: JOIN_TEXT.nameMissing,
  "too-long": JOIN_TEXT.nameTooLong,
  "forbidden-character": JOIN_TEXT.nameInvisible,
  "no-letter": JOIN_TEXT.nameNoLetter,
};
const NAME_TEXTS: ReadonlySet<string> = new Set(Object.values(NAME_PROBLEM_TEXT));

type Phase =
  | { kind: "missing" }
  | { kind: "checking" }
  | { kind: "checkFailed" }
  | { kind: "invalid" }
  | { kind: "form"; preview: InvitePreview }
  | { kind: "redirecting" };

/** The first client-side problem with the name, or null. */
export function checkName(rawName: string): string | null {
  const problem = nameProblem(rawName);
  return problem === null ? null : NAME_PROBLEM_TEXT[problem];
}

export type JoinFailure = { kind: "invalid" } | { kind: "message"; text: string };

/** What a failed join shows: the invalid-invite notice, or a fixed message. */
export function joinFailure(error: unknown): JoinFailure {
  const message = (text: string): JoinFailure => ({ kind: "message", text });
  if (!isApiProblem(error)) return message(JOIN_TEXT.generic);
  if (error.status === HTTP_STATUS.gone) return { kind: "invalid" };
  if (error.status === HTTP_STATUS.conflict) return message(JOIN_TEXT.accountExists);
  if (error.status === HTTP_STATUS.tooManyRequests) return message(JOIN_TEXT.rateLimited);
  if (error.status === HTTP_STATUS.badRequest) return message(JOIN_TEXT.rejected);
  return message(JOIN_TEXT.generic);
}

function SignInLink() {
  return (
    <Button asChild variant="secondary" size="lg" className="w-full">
      <Link to="/login">{JOIN_TEXT.goToSignIn}</Link>
    </Button>
  );
}

interface NoticeProps {
  text: string;
  children?: ReactNode;
}

function Notice({ text, children }: NoticeProps) {
  return (
    <AuthShell title={JOIN_TEXT.title}>
      <p role="alert" className="text-sm">
        {text}
      </p>
      {children ?? <SignInLink />}
    </AuthShell>
  );
}

/**
 * The token from the fragment, and the fragment removed from the address bar. The latest non-empty
 * fragment wins, so a second invite link opened in this tab replaces the first (review round 1, H).
 */
function useInviteToken(): string {
  const hash = useRouterState({ select: (state) => state.location.hash });
  const [token, setToken] = useState(hash);
  if (hash !== "" && hash !== token) setToken(hash);
  const navigate = useNavigate();
  useEffect(() => {
    if (hash !== "") void navigate({ to: "/join", hash: "", replace: true });
  }, [hash, navigate]);
  return token;
}

interface JoinFormProps {
  token: string;
  preview: InvitePreview;
  onInvalid: () => void;
  onJoined: () => void;
}

function JoinForm({ token, preview, onInvalid, onJoined }: JoinFormProps) {
  const joinMutation = useJoin();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [accountExists, setAccountExists] = useState(false);
  const nameId = useId();
  const passwordId = useId();
  const strengthId = useId();
  const messageId = useId();
  const userInputs = useMemo(() => strengthInputs(preview.email, name), [preview.email, name]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = checkName(name) ?? (meetsPasswordMinimum(password) ? null : JOIN_TEXT.passwordShort);
    setMessage(problem);
    setAccountExists(false);
    if (problem !== null) return;
    try {
      await joinMutation.mutateAsync({ token, displayName: name.trim(), password });
    } catch (error: unknown) {
      const failure = joinFailure(error);
      if (failure.kind === "invalid") {
        onInvalid();
        return;
      }
      setMessage(failure.text);
      setAccountExists(failure.text === JOIN_TEXT.accountExists);
      return;
    }
    onJoined();
  }

  const pending = joinMutation.isPending;
  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      <input type="email" name="email" autoComplete="username" value={preview.email} readOnly hidden />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nameId} className="text-sm font-medium">
          {JOIN_TEXT.nameLabel}
        </Label>
        <input
          id={nameId}
          name="name"
          type="text"
          autoComplete="name"
          autoFocus
          maxLength={MAX_RAW_NAME_LENGTH}
          value={name}
          aria-invalid={message !== null && NAME_TEXTS.has(message)}
          onChange={(event) => setName(event.target.value)}
          className={cn(FIELD_CLASS, "h-11 w-full px-3")}
        />
      </div>
      <PasswordField
        id={passwordId}
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        invalid={message === JOIN_TEXT.passwordShort}
        describedBy={strengthId}
      >
        <StrengthMeter id={strengthId} password={password} userInputs={userInputs} />
      </PasswordField>
      {message === null ? null : (
        <p id={messageId} role="alert" className="text-sm text-danger">
          {message}
        </p>
      )}
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
        {pending ? <Spinner /> : null}
        {JOIN_TEXT.create}
      </Button>
      {accountExists ? <SignInLink /> : null}
    </form>
  );
}

export function JoinPage() {
  const token = useInviteToken();
  return <JoinFlow key={token} token={token} />;
}

/** One invite's flow; keyed on the token, so a new link starts it over. */
function JoinFlow({ token }: { token: string }) {
  const api = useAppApi();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>(token === "" ? { kind: "missing" } : { kind: "checking" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (token === "") return;
    let active = true;
    inspectInvite(api, token).then(
      (preview) => {
        if (active) setPhase({ kind: "form", preview });
      },
      (error: unknown) => {
        if (!active) return;
        setPhase(isApiProblem(error) && error.status === HTTP_STATUS.gone ? { kind: "invalid" } : { kind: "checkFailed" });
      },
    );
    return () => {
      active = false;
    };
  }, [api, token, attempt]);

  function joined() {
    setPhase({ kind: "redirecting" });
    void finishWithRedirect(() => navigate({ to: HOME_PATH }));
  }

  switch (phase.kind) {
    case "missing":
      return <Notice text={JOIN_TEXT.missingToken} />;
    case "invalid":
      return <Notice text={JOIN_TEXT.invalid} />;
    case "checkFailed":
      return (
        <Notice text={JOIN_TEXT.checkFailed}>
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={() => {
              setPhase({ kind: "checking" });
              setAttempt((count) => count + 1);
            }}
          >
            {JOIN_TEXT.tryAgain}
          </Button>
        </Notice>
      );
    case "checking":
      return (
        <AuthShell title={JOIN_TEXT.title}>
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <Spinner />
            {JOIN_TEXT.checking}
          </p>
        </AuthShell>
      );
    case "redirecting":
      return <RedirectingState title={JOIN_TEXT.redirecting} />;
    case "form":
      return (
        <AuthShell title={JOIN_TEXT.title} subtitle={<EmailChip email={phase.preview.email} />}>
          <JoinForm token={token} preview={phase.preview} onInvalid={() => setPhase({ kind: "invalid" })} onJoined={joined} />
        </AuthShell>
      );
  }
}
