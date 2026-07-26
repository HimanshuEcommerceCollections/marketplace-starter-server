/**
 * Verification email template. Returns the subject + HTML + plain-text parts of
 * the account-verification message; the branded shell it is poured into lives in
 * ./layout.
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

export interface VerificationEmailParams {
  /** Absolute URL the recipient clicks to verify (points at the frontend). */
  verifyUrl: string;
  /** How long the link stays valid, in whole hours (for the expiry notice). */
  expiresInHours: number;
  /** Optional recipient name for a friendlier greeting. */
  recipientName?: string | null;
}

/** Retained for callers importing the old name; identical to EmailContent. */
export type VerificationEmailContent = EmailContent;

export function buildVerificationEmail(
  params: VerificationEmailParams,
): VerificationEmailContent {
  const { verifyUrl, expiresInHours } = params;
  const rawFirstName = firstNameOf(params.recipientName);
  // Escaped for the HTML body; the plain-text part uses the raw value.
  const firstName = escapeHtml(rawFirstName);

  const subject = "Verify your email for Elevate Health & Wellness";
  const preheader = "Confirm your email address to activate your Elevate account.";

  const html = renderEmailShell({
    title: subject,
    preheader,
    rows: [
      row(
        heading("Confirm your email address") +
          paragraph(
            `Hi ${firstName}, welcome to Elevate. Please confirm this is your email address to activate your account and start booking wellness sessions.`,
          ),
        "36px 40px 8px 40px",
      ),
      buttonRow("Verify email", verifyUrl),
      row(
        linkFallback(verifyUrl) +
          smallText(
            `This link expires in <strong style="color:${BRAND.ink};">${expiresInHours} hours</strong>. If you didn't create an Elevate account, you can safely ignore this email.`,
            24,
          ),
        "0 40px 8px 40px",
      ),
    ].join("\n            "),
  });

  const text = [
    `Welcome to Elevate Health & Wellness, ${rawFirstName}!`,
    ``,
    `Please confirm your email address to activate your account by opening this link:`,
    verifyUrl,
    ``,
    `This link expires in ${expiresInHours} hours. If you didn't create an Elevate account, you can safely ignore this email.`,
    ``,
    TEXT_SIGNOFF,
  ].join("\n");

  return { subject, html, text };
}
