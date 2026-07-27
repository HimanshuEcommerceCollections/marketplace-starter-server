/**
 * Booking-status notification emails — the outbound counterpart of the in-app
 * BOOKING_CONFIRMED / BOOKING_CANCELLED notifications. Shares the branded shell
 * in ./layout with the verification email.
 */
import {
  BRAND,
  TEXT_SIGNOFF,
  buttonRow,
  escapeHtml,
  firstNameOf,
  heading,
  link,
  paragraph,
  renderEmailShell,
  row,
  smallText,
  type EmailContent,
} from "./layout";

export interface BookingStatusEmailParams {
  /** Human-facing booking reference, e.g. "ELV-4F2A9C". */
  reference: string;
  /** Absolute URL of the booking detail page on the frontend. */
  bookingUrl: string;
  /** Optional recipient name for a friendlier greeting. */
  recipientName?: string | null;
}

/** Reference shown as a monospace chip so it survives copy-paste cleanly. */
function referenceChip(reference: string): string {
  return `<span style="display:inline-block;font-family:'Courier New',monospace;font-size:14px;font-weight:700;color:${BRAND.ink};background-color:${BRAND.bg};border:1px solid ${BRAND.line};border-radius:6px;padding:4px 10px;">${reference}</span>`;
}

function build(params: {
  subject: string;
  preheader: string;
  headline: string;
  intro: string;
  closing: string;
  cta: string;
  reference: string;
  bookingUrl: string;
  textBody: string[];
}): EmailContent {
  const html = renderEmailShell({
    title: params.subject,
    preheader: params.preheader,
    rows: [
      row(
        heading(params.headline) +
          paragraph(params.intro, 12) +
          `<p style="margin:0 0 16px 0;">${referenceChip(params.reference)}</p>`,
        "36px 40px 8px 40px",
      ),
      buttonRow(params.cta, params.bookingUrl),
      row(
        smallText(
          `${params.closing} You can also open your booking here: ${link(params.bookingUrl)}`,
          24,
        ),
        "0 40px 8px 40px",
      ),
    ].join("\n            "),
  });

  return {
    subject: params.subject,
    html,
    text: [...params.textBody, ``, TEXT_SIGNOFF].join("\n"),
  };
}

export function buildBookingConfirmedEmail(
  params: BookingStatusEmailParams,
): EmailContent {
  const rawFirstName = firstNameOf(params.recipientName);
  const reference = escapeHtml(params.reference);

  return build({
    subject: `Your Elevate booking ${params.reference} is confirmed`,
    preheader: `Booking ${params.reference} is confirmed — we'll see you soon.`,
    headline: "Your booking is confirmed",
    intro: `Hi ${escapeHtml(rawFirstName)}, good news — your session is confirmed and on our schedule.`,
    closing: "Need to make a change? Reach out and we'll help you reschedule.",
    cta: "View booking",
    reference,
    bookingUrl: params.bookingUrl,
    textBody: [
      `Hi ${rawFirstName},`,
      ``,
      `Good news — your Elevate session is confirmed.`,
      ``,
      `Booking reference: ${params.reference}`,
      `View your booking: ${params.bookingUrl}`,
      ``,
      `Need to make a change? Reach out and we'll help you reschedule.`,
    ],
  });
}

export function buildBookingCancelledEmail(
  params: BookingStatusEmailParams,
): EmailContent {
  const rawFirstName = firstNameOf(params.recipientName);
  const reference = escapeHtml(params.reference);

  return build({
    subject: `Your Elevate booking ${params.reference} was cancelled`,
    preheader: `Booking ${params.reference} has been cancelled.`,
    headline: "Your booking was cancelled",
    // Deliberately conditional about the refund: this same email covers a staff
    // cancellation (possibly unpaid) and a refund-driven cancellation.
    intro: `Hi ${escapeHtml(rawFirstName)}, the session below has been cancelled. If a payment had already been taken, it is being refunded to the original payment method.`,
    closing: "Refunds usually land within 5–10 business days, depending on your bank.",
    cta: "View booking",
    reference,
    bookingUrl: params.bookingUrl,
    textBody: [
      `Hi ${rawFirstName},`,
      ``,
      `Your Elevate session has been cancelled. If a payment had already been taken, it is being refunded to the original payment method.`,
      ``,
      `Booking reference: ${params.reference}`,
      `View your booking: ${params.bookingUrl}`,
      ``,
      `Refunds usually land within 5-10 business days, depending on your bank.`,
    ],
  });
}
