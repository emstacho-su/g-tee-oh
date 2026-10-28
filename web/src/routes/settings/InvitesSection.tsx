/**
 * The admin Invites page of /settings (S42, R3.5, O-349, O-420, O-423, O-427). An admin types an
 * email and creates an invite; the join link shows once, in a dialog with a Copy button, and is
 * dropped from memory when the dialog closes. Below, the newest invites with their status; a
 * pending one can be revoked behind a confirmation. A member who opens the URL reads a note.
 *
 * Mechanism: the link lives only in this component's state. createInvite is called directly, not
 * through a mutation, so the link never enters the QueryClient (O-427); it is never written to
 * storage either. Create and revoke refresh the list query, which carries no secret. Revoke goes
 * through useIntentMutation, so a double click sends one request under one Idempotency-Key. A 403
 * forbidden means the admin flag was revoked meanwhile, so the me query is rechecked. Failures map
 * to fixed texts; the server's detail is never shown. Every field uses FIELD_CLASS (S36).
 */
import { Label } from "@radix-ui/react-label";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";

import { HTTP_STATUS, isApiProblem } from "../../api/index.js";
import { EMAIL_SHAPE, INVITE_TTL_DAYS } from "../../auth/account-rules.js";
import { ME_QUERY_KEY, useAppApi } from "../../auth/index.js";
import { Button, cn, Dialog, FIELD_CLASS, LoadingNote, Panel } from "../../components/ui/index.js";
import type { InviteSummary } from "../../contracts.js";
import { isForbidden, useIsAdmin } from "../../library/use-builder.js";
import { useIntentMutation } from "../../library/use-intent-mutation.js";
import { createInvite, INVITE_LIST_LIMIT, INVITES_QUERY_KEY, invitesQueryOptions, revokeInvite } from "./invites-query.js";
import { SettingsSection } from "./SettingsSection.js";
import { expiresText, INVITES_TEXT, invitesDescription, linkExpiryText, moreInvitesText, revokeDescription } from "./settings-text.js";

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

export function formatInviteDate(iso: string): string {
  return DATE_FORMAT.format(new Date(iso));
}

/** The fixed text for a failed create; never the server's detail. */
export function createFailureText(error: unknown): string {
  if (isApiProblem(error) && error.status === HTTP_STATUS.conflict) return INVITES_TEXT.accountExists;
  if (isApiProblem(error) && error.status === HTTP_STATUS.badRequest) return INVITES_TEXT.emailShape;
  if (isApiProblem(error) && error.status === HTTP_STATUS.tooManyRequests) return INVITES_TEXT.rateLimited;
  return INVITES_TEXT.createFailed;
}

interface CreatedLink {
  link: string;
  expiresAt: string;
}

function useRecheckOnForbidden(): (error: unknown) => void {
  const queryClient = useQueryClient();
  return (error) => {
    if (isForbidden(error)) void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
  };
}

function CreateInviteForm({ onCreated }: { onCreated: (created: CreatedLink) => void }) {
  const api = useAppApi();
  const queryClient = useQueryClient();
  const recheck = useRecheckOnForbidden();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const emailId = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const trimmed = email.trim();
    const problem = trimmed === "" ? INVITES_TEXT.emailMissing : EMAIL_SHAPE.test(trimmed) ? null : INVITES_TEXT.emailShape;
    setMessage(problem);
    if (problem !== null) return;
    setPending(true);
    try {
      const created = await createInvite(api, trimmed);
      setEmail("");
      onCreated({ link: created.link, expiresAt: created.invite.expires_at });
    } catch (error: unknown) {
      recheck(error);
      setMessage(createFailureText(error));
    } finally {
      setPending(false);
      void queryClient.invalidateQueries({ queryKey: INVITES_QUERY_KEY });
    }
  }

  return (
    <form noValidate className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end" onSubmit={(event) => void submit(event)}>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor={emailId} className="text-sm font-medium">
          {INVITES_TEXT.emailLabel}
        </Label>
        <input
          id={emailId}
          name="invite-email"
          type="email"
          autoComplete="off"
          value={email}
          aria-invalid={message !== null}
          onChange={(event) => setEmail(event.target.value)}
          className={cn(FIELD_CLASS, "h-10 w-full px-3")}
        />
      </div>
      <Button type="submit" variant="primary" disabled={pending} aria-busy={pending}>
        {INVITES_TEXT.create}
      </Button>
      {message === null ? null : (
        <p role="alert" className="text-sm text-danger sm:basis-full">
          {message}
        </p>
      )}
    </form>
  );
}

function LinkDialog({ created, onClose }: { created: CreatedLink | null; onClose: () => void }) {
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const linkId = useId();

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopyNote(INVITES_TEXT.copied);
    } catch {
      setCopyNote(INVITES_TEXT.copyFailed);
    }
  }

  function close() {
    setCopyNote(null);
    onClose();
  }

  return (
    <Dialog
      open={created !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={INVITES_TEXT.linkTitle}
      description={INVITES_TEXT.linkDescription}
    >
      {created === null ? null : (
        <div className="flex flex-col gap-3">
          <Label htmlFor={linkId} className="text-sm font-medium">
            {INVITES_TEXT.linkLabel}
          </Label>
          <input
            id={linkId}
            readOnly
            value={created.link}
            onFocus={(event) => event.target.select()}
            className={cn(FIELD_CLASS, "h-10 w-full px-3 font-mono text-xs")}
          />
          <p className="text-sm text-muted">{linkExpiryText(formatInviteDate(created.expiresAt))}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => void copy(created.link)}>
              {INVITES_TEXT.copy}
            </Button>
            <p role="status" className="text-sm text-muted">
              {copyNote ?? ""}
            </p>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function StatusPill({ status }: { status: InviteSummary["status"] }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-xs",
        status === "pending" ? "border-border-strong text-text" : "border-border text-muted",
      )}
    >
      {INVITES_TEXT.status[status]}
    </span>
  );
}

function InviteRow({ invite, onRevoke }: { invite: InviteSummary; onRevoke: (invite: InviteSummary) => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 py-2 first:border-t-0">
      <span className="min-w-0 flex-1 truncate text-sm" title={invite.email}>
        {invite.email}
      </span>
      <StatusPill status={invite.status} />
      <span className="text-xs text-muted">{expiresText(formatInviteDate(invite.expires_at))}</span>
      {invite.status === "pending" ? (
        <Button size="sm" variant="ghost" onClick={() => onRevoke(invite)} aria-label={`${INVITES_TEXT.revoke} ${invite.email}`}>
          {INVITES_TEXT.revoke}
        </Button>
      ) : null}
    </li>
  );
}

function RevokeDialog({ invite, onClose }: { invite: InviteSummary; onClose: () => void }) {
  const api = useAppApi();
  const queryClient = useQueryClient();
  const recheck = useRecheckOnForbidden();
  const revoke = useIntentMutation<string, InviteSummary>({
    run: (id, key) => revokeInvite(api, id, key),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: INVITES_QUERY_KEY });
      onClose();
    },
    onError: recheck,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={INVITES_TEXT.revokeTitle}
      description={revokeDescription(invite.email)}
    >
      {revoke.error === undefined || revoke.error === null ? null : (
        <p role="alert" className="mb-3 text-sm text-danger">
          {INVITES_TEXT.revokeFailed}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>{INVITES_TEXT.cancel}</Button>
        <Button variant="danger" disabled={revoke.busy} onClick={() => revoke.send(invite.id)}>
          {INVITES_TEXT.revokeConfirm}
        </Button>
      </div>
    </Dialog>
  );
}

function InviteList() {
  const api = useAppApi();
  const invites = useQuery(invitesQueryOptions(api, true));
  const [revoking, setRevoking] = useState<InviteSummary | null>(null);

  if (invites.data === undefined) {
    if (!invites.isError) return <LoadingNote text={INVITES_TEXT.loading} />;
    return (
      <div role="alert" className="flex flex-col items-start gap-2 text-sm">
        <p className="text-danger">{INVITES_TEXT.loadFailed}</p>
        <Button size="sm" onClick={() => void invites.refetch()}>
          {INVITES_TEXT.tryAgain}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-base font-semibold">{INVITES_TEXT.listTitle}</h3>
      {invites.data.items.length === 0 ? (
        <p className="text-sm text-muted">{INVITES_TEXT.empty}</p>
      ) : (
        <ul aria-label={INVITES_TEXT.listTitle} className="flex flex-col">
          {invites.data.items.map((invite) => (
            <InviteRow key={invite.id} invite={invite} onRevoke={setRevoking} />
          ))}
        </ul>
      )}
      {invites.data.hasMore ? <p className="text-xs text-muted">{moreInvitesText(INVITE_LIST_LIMIT)}</p> : null}
      {revoking === null ? null : <RevokeDialog invite={revoking} onClose={() => setRevoking(null)} />}
    </div>
  );
}

export function InvitesSection() {
  const isAdmin = useIsAdmin();
  const [created, setCreated] = useState<CreatedLink | null>(null);
  if (!isAdmin) {
    return (
      <Panel>
        <p className="text-sm text-muted">{INVITES_TEXT.memberNote}</p>
      </Panel>
    );
  }
  return (
    <SettingsSection title={INVITES_TEXT.title} description={invitesDescription(INVITE_TTL_DAYS)}>
      <CreateInviteForm onCreated={setCreated} />
      <InviteList />
      <LinkDialog created={created} onClose={() => setCreated(null)} />
    </SettingsSection>
  );
}
