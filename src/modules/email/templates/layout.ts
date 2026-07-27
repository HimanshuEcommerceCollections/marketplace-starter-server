/**
 * Shared email chrome. Every transactional message is composed from these
 * helpers so the branded shell, palette and footer live in one place and the
 * individual templates only describe their own content. Kept as plain functions
 * returning strings (the codebase has no view/templating engine); all styling is
 * inlined for broad email-client compatibility.
 */

/** Subject + both body parts, as handed to an EmailProvider. */
export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

/** Elevate brand palette (deep green primary + terracotta accent). */
export const BRAND = {
  green: "#1f6f5c",
  greenDark: "#17564a",
  terra: "#c8613f",
  ink: "#1c2b27",
  muted: "#5b6b66",
  line: "#e4ebe8",
  bg: "#f4f7f5",
  card: "#ffffff",
};

/** Email clients are unreliable with webfonts; stick to a system stack. */
export const FONT = "Arial,Helvetica,sans-serif";

/** Escape a value for safe interpolation into HTML text/attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Main headline of a message. */
export function heading(text: string): string {
  return `<h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;color:${BRAND.ink};">${text}</h1>`;
}

/** Body copy. */
export function paragraph(html: string, marginBottom = 16): string {
  return `<p style="margin:0 0 ${marginBottom}px 0;font-size:15px;line-height:1.6;color:${BRAND.muted};">${html}</p>`;
}

/** Secondary copy — link fallbacks, expiry notices, disclaimers. */
export function smallText(html: string, marginBottom = 20): string {
  return `<p style="margin:0 0 ${marginBottom}px 0;font-size:13px;line-height:1.6;color:${BRAND.muted};">${html}</p>`;
}

/** Inline link in brand green. */
export function link(url: string, label = url): string {
  return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:${BRAND.green};text-decoration:underline;">${label}</a>`;
}

/** A content band inside the card. */
export function row(innerHtml: string, padding: string): string {
  return `<tr>
              <td style="padding:${padding};font-family:${FONT};">${innerHtml}</td>
            </tr>`;
}

/** Terracotta pill call-to-action, centred in its own band. */
export function buttonRow(
  label: string,
  url: string,
  padding = "12px 40px 20px 40px",
): string {
  return `<tr>
              <td align="center" style="padding:${padding};">
                <a href="${url}" target="_blank" rel="noopener noreferrer"
                   style="display:inline-block;background-color:${BRAND.terra};color:#ffffff;font-family:${FONT};font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:9999px;">
                  ${label}
                </a>
              </td>
            </tr>`;
}

/**
 * Copy-paste fallback for the CTA — a meaningful share of recipients read mail
 * in clients that strip or mangle button links.
 */
export function linkFallback(url: string): string {
  return `${smallText("Button not working? Paste this link into your browser:", 8)}
                <p style="margin:0 0 20px 0;font-size:13px;line-height:1.6;word-break:break-all;">${link(url)}</p>`;
}

export interface EmailShellParams {
  /** Document <title>; conventionally the same text as the subject. */
  title: string;
  /** Inbox preview line, hidden in the body. */
  preheader: string;
  /** Pre-built `<tr>` bands, e.g. from row()/buttonRow(). */
  rows: string;
}

/** Wrap content bands in the branded card, header and footer. */
export function renderEmailShell({ title, preheader, rows }: EmailShellParams): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${title}</title>
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
                <span style="font-family:${FONT};font-size:12px;letter-spacing:2px;color:#d6e7e0;text-transform:uppercase;display:block;margin-top:2px;">Health &amp; Wellness</span>
              </td>
            </tr>
            ${rows}
            <tr>
              <td style="padding:20px 40px 32px 40px;border-top:1px solid ${BRAND.line};font-family:${FONT};">
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
}

/** First name for a greeting, falling back to a neutral "there". */
export function firstNameOf(recipientName?: string | null): string {
  const trimmed = recipientName?.trim();
  return trimmed ? trimmed.split(/\s+/)[0] : "there";
}

/** Plain-text signature every message closes with. */
export const TEXT_SIGNOFF = "— The Elevate Health & Wellness team";
