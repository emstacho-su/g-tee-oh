/**
 * Fixed text of the S32 /settings sections (R4.12, R4.14, O-323, O-327). The grouping names come
 * from src/drills/labels.ts (GROUPING_LABELS), shared with the drill builder and the start panels.
 */

export const SESSION_DEFAULTS_TEXT = {
  title: "Session defaults",
  description: "The Train screen starts automated sessions with these choices. They are kept on this browser only.",
  grouping: "Grouping",
  scopeLegend: "Configurations",
  scopeAll: "All covered configurations",
  scopeChosen: "Only the configurations I choose",
  chooseList: "Configurations to train",
  noneChosen: "Choose at least one configuration. Until then, sessions use all covered configurations.",
  saved: "Saved on this browser.",
  loadingConfigs: "Loading the configurations.",
  configsFailed: "The configurations could not be loaded.",
  noConfigs: "No configurations are in the catalog yet.",
  removeStale: "Remove them",
} as const;

export const CONFIG_SCOPE_TEXT = {
  title: "Configuration scope",
  description: "The game configurations automated sessions draw from. Kept on this browser only.",
} as const;

export const SETTINGS_TEXT = {
  title: "Settings",
  description: "How training starts, what the app looks like and the keys it answers to.",
  sections: "Settings sections",
  scheduleMemberNote: "The builder schedule is for admins.",
} as const;

/** The admin Invites page (S42, R3.5, O-349, O-420, O-423, O-427). */
export const INVITES_TEXT = {
  title: "Invites",
  memberNote: "Invites are for admins.",
  emailLabel: "Email to invite",
  create: "Create invite",
  emailMissing: "Enter the email address to invite.",
  emailShape: "Enter an email address like name@example.com.",
  accountExists: "An account already exists for this email.",
  rateLimited: "Too many invites in a minute. Wait and try again.",
  createFailed: "The invite could not be created. Try again.",
  linkTitle: "Invite link",
  linkDescription: "Copy it now: it is shown only once. Send it to the person yourself.",
  linkLabel: "Join link",
  copy: "Copy link",
  copied: "Copied.",
  copyFailed: "Copy did not work. Select the link and copy it by hand.",
  listTitle: "Recent invites",
  empty: "No invites yet.",
  loading: "Loading the invites.",
  loadFailed: "The invites could not be loaded.",
  tryAgain: "Try again",
  revoke: "Revoke",
  revokeTitle: "Revoke this invite?",
  revokeConfirm: "Revoke invite",
  cancel: "Cancel",
  revokeFailed: "The invite could not be revoked. Try again.",
  status: { pending: "Pending", used: "Used", expired: "Expired", revoked: "Revoked" },
} as const;

export function invitesDescription(ttlDays: number): string {
  return `Invite someone by email. Each link works once and expires after ${ttlDays} days.`;
}

export function moreInvitesText(limit: number): string {
  return `Showing the ${limit} most recent invites.`;
}

export function revokeDescription(email: string): string {
  return `The link sent to ${email} will stop working. This cannot be undone.`;
}

export function expiresText(date: string): string {
  return `Expires ${date}`;
}

export function linkExpiryText(date: string): string {
  return `It works once, until ${date}.`;
}

export function staleConfigsText(ids: readonly string[]): string {
  return `Saved configurations no longer offered: ${ids.join(", ")}.`;
}

export function scopeCapText(max: number): string {
  return `At most ${max} configurations can be chosen.`;
}

export const COSMETICS_TEXT = {
  title: "Cosmetics",
  note: "Cosmetics change only how the app looks; they never change training.",
  none: "None",
  noneHint: "The standard look",
  locked: "Locked",
  loading: "Loading your unlocks.",
  failed: "Your unlocks could not be loaded.",
} as const;

export const COSMETIC_SLOT_TITLES = {
  "card-back": "Card back",
  felt: "Table felt",
  badge: "Badge",
} as const;

export const HOTKEYS_TEXT = {
  title: "Hotkeys",
  description: "The keyboard shortcuts of the trainer and the app. Press ? on any screen to see the ones active there.",
  later: "Rebinding keys comes in a later version.",
  caption: "Keyboard shortcuts",
} as const;
