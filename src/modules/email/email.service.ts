import { env } from "../../config/env";
import { ApiError } from "../../utils/api-error";
import { logger } from "../../utils/logger";
import { resolveEmailProvider } from "./providers";
import type { EmailProvider } from "./providers";
import { buildVerificationEmail } from "./templates/verification";
import {
  buildBookingCancelledEmail,
  buildBookingConfirmedEmail,
} from "./templates/booking-status";
import type { EmailContent } from "./templates/layout";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Transactional email delivery. Owns all outbound mail so callers (auth,
 * notifications) never touch a transport: they ask for a message by intent and
 * this service composes the template and hands it to whichever adapter
 * EMAIL_PROVIDER selects (Gmail/SMTP/Resend — see ./providers).
 *
 * In-app notification rows remain the separate `notifications` module's concern;
 * that module calls in here for the email half.
 */
export class EmailService {
  /** The adapter EMAIL_PROVIDER selects. Resolved per call so importing this
   *  module never constructs a transport. */
  private get provider(): EmailProvider {
    return resolveEmailProvider();
  }

  /** True when the active adapter has all the credentials it needs. */
  isConfigured(): boolean {
    return this.provider.missingEnv().length === 0;
  }

  /**
   * Send the account-verification email. Throws if the active provider is not
   * configured or rejects the send — callers decide whether a failure is fatal
   * (it is not for signup/resend, which log and continue).
   */
  async sendVerificationEmail(
    to: string,
    verifyUrl: string,
    recipientName?: string | null,
  ): Promise<void> {
    await this.deliver(
      to,
      buildVerificationEmail({
        verifyUrl,
        expiresInHours: Math.round(env.EMAIL_VERIFICATION_TTL_MS / HOUR_MS),
        recipientName,
      }),
      "Verification",
    );
  }

  /** Booking-confirmed notice for the customer. */
  async sendBookingConfirmedEmail(
    to: string,
    booking: { id: string; reference: string },
    recipientName?: string | null,
  ): Promise<void> {
    await this.deliver(
      to,
      buildBookingConfirmedEmail({
        reference: booking.reference,
        bookingUrl: this.bookingUrl(booking.id),
        recipientName,
      }),
      "Booking-confirmed",
    );
  }

  /** Booking-cancelled notice for the customer. */
  async sendBookingCancelledEmail(
    to: string,
    booking: { id: string; reference: string },
    recipientName?: string | null,
  ): Promise<void> {
    await this.deliver(
      to,
      buildBookingCancelledEmail({
        reference: booking.reference,
        bookingUrl: this.bookingUrl(booking.id),
        recipientName,
      }),
      "Booking-cancelled",
    );
  }

  /** Frontend booking-detail URL (APP_URL is the client origin, not the API). */
  private bookingUrl(bookingId: string): string {
    return `${env.APP_URL.replace(/\/+$/, "")}/bookings/${bookingId}`;
  }

  /**
   * Single exit point to the transport: validates configuration, sends, logs.
   * A missing credential surfaces as a 501 naming the exact env vars to set.
   */
  private async deliver(
    to: string,
    content: EmailContent,
    label: string,
  ): Promise<void> {
    const provider = this.provider;
    const missing = provider.missingEnv();
    if (missing.length > 0) {
      throw ApiError.notImplemented(
        `Email is not configured for provider "${provider.name}" (set ${missing.join(", ")})`,
      );
    }

    const { messageId } = await provider.send({ to, ...content });

    logger.info(`${label} email sent to ${to}`, {
      provider: provider.name,
      messageId,
    });
  }
}

export const emailService = new EmailService();

/**
 * One-line boot summary of the mail setup. Called from server.ts so a
 * misconfigured deployment is obvious in the logs instead of only surfacing when
 * the first user signs up.
 */
export function logEmailStartupState(): void {
  const provider = resolveEmailProvider();
  const missing = provider.missingEnv();

  if (missing.length > 0) {
    logger.warn(
      `Email provider "${provider.name}" is NOT configured (set ${missing.join(", ")}) — ` +
        "verification and notification emails will be skipped",
    );
    return;
  }

  logger.info(
    `Email provider "${provider.name}" ready as ${provider.describeSender()}` +
      (env.EMAIL_NOTIFICATIONS_ENABLED ? "" : " (notification emails disabled)"),
  );
}
