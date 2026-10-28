/**
 * Every fixed text of the sign-in and join flows (S42, R3.13, O-349, O-421, O-422, O-425). The
 * server's own detail text is never shown, and neither is a password or a token: failures map to
 * these strings by status and problem slug only.
 */
export const SIGN_IN_TEXT = {
  title: "Sign in",
  emailStepHint: "Enter the email you use for g-tee-oh.",
  continue: "Continue",
  signIn: "Sign in",
  useDifferentEmail: "Use a different email",
  emailMissing: "Enter your email address.",
  emailShape: "Enter an email address like name@example.com.",
  passwordMissing: "Enter your password.",
  incorrect: "Email or password is incorrect.",
  rateLimited: "Too many sign-in attempts. Wait a minute and try again.",
  generic: "Sign-in failed. Try again.",
  serviceUnavailable: "The service is unavailable right now. You can still try to sign in.",
  redirecting: "Signing you in",
} as const;

export const JOIN_TEXT = {
  title: "Join g-tee-oh",
  checking: "Checking your invite",
  invalid: "This invite link is not valid. It may have expired or been used already. Ask for a new one.",
  missingToken: "This page needs the invite link you were sent. Open the full link and try again.",
  goToSignIn: "Go to sign in",
  nameLabel: "Name",
  nameMissing: "Enter your name.",
  nameTooLong: "Use 60 characters or fewer for your name.",
  nameInvisible: "Remove invisible or control characters from your name.",
  nameNoLetter: "Use at least one letter or digit in your name.",
  passwordShort: "Use at least 12 characters for your password.",
  create: "Create account",
  accountExists: "An account already exists for this email. Sign in instead.",
  rateLimited: "Too many attempts. Wait a minute and try again.",
  rejected: "Check your name and password and try again.",
  generic: "Something went wrong. Try again.",
  checkFailed: "The invite could not be checked right now.",
  tryAgain: "Try again",
  redirecting: "Setting up your account",
} as const;

export const PASSWORD_TEXT = {
  label: "Password",
  show: "Show password",
  hide: "Hide password",
  strengthLabel: "Password strength",
} as const;

export const STRENGTH_LABELS = ["Too short", "Weak", "Fair", "Good", "Strong"] as const;
export type StrengthLabel = (typeof STRENGTH_LABELS)[number];

export const REDIRECT_NOTE = "You are being redirected.";
