/**
 * Invite email template. Sent when an admin/coordinator provisions an account
 * that has no password yet (status INVITED) — an accepted professional or an
 * internal coordinator. The recipient clicks through to set their own password,
 * which is what actually activates the account.
 */
import {
  BRAND,
  TEXT_SIGNOFF,
  buttonRow,
  escapeHtml,
  firstNameOf,
  heading,
  linkFallback,
  paragraph,
  renderEmailShell,
  row,
  smallText,
  type EmailContent,
} from "./layout";

export interface InviteEmailParams {
  /** Absolute URL the recipient clicks to set a password (points at the frontend). */
  inviteUrl: string;
  /** How long the link stays valid, in whole hours. */
  expiresInHours: number;
  /** Optional recipient name for a friendlier greeting. */
  recipientName?: string | null;
  /**
   * What they have been invited as. Shapes the copy: an accepted practitioner is
   * being welcomed onto the marketplace, a coordinator is being handed internal
   * tools. Anything else falls back to the neutral provider wording.
   */
  kind: "provider" | "staff";
  /** Human-readable role label for the staff variant (e.g. "Coordinator"). */
  roleLabel?: string;
}

function hoursOrDays(hours: number): string {
  if (hours < 48) return `${hours} hours`;
  return `${Math.round(hours / 24)} days`;
}

export function buildInviteEmail(params: InviteEmailParams): EmailContent {
  const { inviteUrl, expiresInHours, kind } = params;
  const rawFirstName = firstNameOf(params.recipientName);
  const firstName = escapeHtml(rawFirstName);
  const validFor = hoursOrDays(expiresInHours);
  const isProvider = kind === "provider";
  const roleLabel = escapeHtml(params.roleLabel ?? "Coordinator");

  const subject = isProvider
    ? "You're in — set up your Elevate practitioner account"
    : `You've been invited to the Elevate ${params.roleLabel ?? "Coordinator"} team`;

  const preheader = isProvider
    ? "Your application was accepted. Set a password to activate your account."
    : "Set a password to activate your Elevate staff account.";

  const openingHtml = isProvider
    ? `Hi ${firstName}, great news — your application to join Elevate Health &amp; Wellness has been accepted. Set a password below to activate your practitioner account, then you can complete your profile and start taking bookings.`
    : `Hi ${firstName}, you've been invited to join the Elevate Health &amp; Wellness team as a <strong style="color:${BRAND.ink};">${roleLabel}</strong>. Set a password below to activate your account.`;

  const html = renderEmailShell({
    title: subject,
    preheader,
    rows: [
      row(
        heading(isProvider ? "Welcome to Elevate" : "You've been invited") +
          paragraph(openingHtml),
        "36px 40px 8px 40px",
      ),
      buttonRow("Set your password", inviteUrl),
      row(
        linkFallback(inviteUrl) +
          smallText(
            `This invitation expires in <strong style="color:${BRAND.ink};">${validFor}</strong>. ` +
              "If it lapses before you get to it, ask your Elevate contact to send a new one. " +
              "If you weren't expecting this invitation, you can safely ignore this email.",
            24,
          ),
        "0 40px 8px 40px",
      ),
    ].join("\n            "),
  });

  const openingText = isProvider
    ? `Great news, ${rawFirstName} — your application to join Elevate Health & Wellness has been accepted.`
    : `Hi ${rawFirstName}, you've been invited to join the Elevate Health & Wellness team as a ${params.roleLabel ?? "Coordinator"}.`;

  const text = [
    openingText,
    ``,
    `Set a password to activate your account by opening this link:`,
    inviteUrl,
    ``,
    `This invitation expires in ${validFor}. If it lapses before you get to it, ask your Elevate contact to send a new one. If you weren't expecting this invitation, you can safely ignore this email.`,
    ``,
    TEXT_SIGNOFF,
  ].join("\n");

  return { subject, html, text };
}
