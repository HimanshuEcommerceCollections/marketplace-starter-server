/**
 * Verification email template. Returns the subject + HTML + plain-text parts of
 * the account-verification message. Kept as a plain function returning strings
 * (the codebase has no view/templating engine); all styling is inlined for
 * broad email-client compatibility.
 */

export interface VerificationEmailParams {
  /** Absolute URL the recipient clicks to verify (points at the frontend). */
  verifyUrl: string;
  /** How long the link stays valid, in whole hours (for the expiry notice). */
  expiresInHours: number;
  /** Optional recipient name for a friendlier greeting. */
  recipientName?: string | null;
}

export interface VerificationEmailContent {
  subject: string;
  html: string;
  text: string;
}

/** Escape a value for safe interpolation into HTML text/attributes. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Elevate brand palette (deep green primary + terracotta accent).
const BRAND = {
  green: "#1f6f5c",
  greenDark: "#17564a",
  terra: "#c8613f",
  ink: "#1c2b27",
  muted: "#5b6b66",
  line: "#e4ebe8",
  bg: "#f4f7f5",
  card: "#ffffff",
};

export function buildVerificationEmail(
  params: VerificationEmailParams,
): VerificationEmailContent {
  const { verifyUrl, expiresInHours } = params;
  const rawFirstName = params.recipientName?.trim()
    ? params.recipientName.trim().split(/\s+/)[0]
    : "there";
  // Escaped for the HTML body; the plain-text part uses the raw value.
  const firstName = escapeHtml(rawFirstName);

  const subject = "Verify your email for Elevate Health & Wellness";
  const preheader = "Confirm your email address to activate your Elevate account.";

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${BRAND.bg};">
    <span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all;">${preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.bg};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:${BRAND.card};border:1px solid ${BRAND.line};border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background-color:${BRAND.green};padding:28px 40px;">
                <span style="font-family:'Georgia',serif;font-size:22px;font-weight:700;letter-spacing:0.4px;color:#ffffff;">Elevate</span>
                <span style="font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:2px;color:#d6e7e0;text-transform:uppercase;display:block;margin-top:2px;">Health &amp; Wellness</span>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 40px 8px 40px;font-family:Arial,Helvetica,sans-serif;">
                <h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;color:${BRAND.ink};">Confirm your email address</h1>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:${BRAND.muted};">
                  Hi ${firstName}, welcome to Elevate. Please confirm this is your email address to activate your account and start booking wellness sessions.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:12px 40px 20px 40px;">
                <a href="${verifyUrl}" target="_blank" rel="noopener noreferrer"
                   style="display:inline-block;background-color:${BRAND.terra};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:9999px;">
                  Verify email
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 40px 8px 40px;font-family:Arial,Helvetica,sans-serif;">
                <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:${BRAND.muted};">
                  Button not working? Paste this link into your browser:
                </p>
                <p style="margin:0 0 20px 0;font-size:13px;line-height:1.6;word-break:break-all;">
                  <a href="${verifyUrl}" target="_blank" rel="noopener noreferrer" style="color:${BRAND.green};text-decoration:underline;">${verifyUrl}</a>
                </p>
                <p style="margin:0 0 24px 0;font-size:13px;line-height:1.6;color:${BRAND.muted};">
                  This link expires in <strong style="color:${BRAND.ink};">${expiresInHours} hours</strong>. If you didn't create an Elevate account, you can safely ignore this email.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 40px 32px 40px;border-top:1px solid ${BRAND.line};font-family:Arial,Helvetica,sans-serif;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:${BRAND.muted};">
                  Elevate Health &amp; Wellness &middot; Wake County, NC<br />
                  This is an automated message; please don't reply directly.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    `Welcome to Elevate Health & Wellness, ${rawFirstName}!`,
    ``,
    `Please confirm your email address to activate your account by opening this link:`,
    verifyUrl,
    ``,
    `This link expires in ${expiresInHours} hours. If you didn't create an Elevate account, you can safely ignore this email.`,
    ``,
    `— The Elevate Health & Wellness team`,
  ].join("\n");

  return { subject, html, text };
}
