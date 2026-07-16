import { getResendClient } from "../../config/resend";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { buildVerificationEmail } from "./templates/verification";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Transactional email delivery via Resend. Owns all outbound mail so callers
 * (e.g. the auth service) never touch the transport directly. In-app
 * notifications remain the separate `notifications` module's concern.
 */
export class EmailService {
  /**
   * Send the account-verification email. Throws if Resend is not configured
   * (via getResendClient) or the API rejects the send — callers decide whether
   * a failure is fatal (it is not for signup/resend, which log and continue).
   */
  async sendVerificationEmail(
    to: string,
    verifyUrl: string,
    recipientName?: string | null,
  ): Promise<void> {
    const { subject, html, text } = buildVerificationEmail({
      verifyUrl,
      expiresInHours: Math.round(env.EMAIL_VERIFICATION_TTL_MS / HOUR_MS),
      recipientName,
    });

    const { error } = await getResendClient().emails.send({
      from: env.EMAIL_FROM,
      to,
      subject,
      html,
      text,
    });

    // Resend returns { data, error } instead of throwing on API errors.
    if (error) {
      logger.error("Resend rejected verification email", error);
      throw new Error(error.message ?? "Failed to send verification email");
    }

    logger.info(`Verification email sent to ${to}`);
  }
}

export const emailService = new EmailService();
