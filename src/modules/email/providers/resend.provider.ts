import { env } from "../../../config/env";
import { getResendClient } from "../../../config/resend";
import { logger } from "../../../utils/logger";
import type {
  EmailProvider,
  SendEmailParams,
  SentEmail,
} from "./email-provider.interface";

/**
 * Resend HTTP API adapter. Kept alongside the SMTP adapters so a deployment can
 * move between them with EMAIL_PROVIDER alone.
 *
 * Resend's shared onboarding sender is the fallback when EMAIL_FROM is unset; it
 * only delivers to the Resend account owner's own address, which is fine for
 * local testing but must be replaced with a verified domain sender in production.
 */
const SANDBOX_SENDER = "onboarding@resend.dev";

function sender(): string {
  if (env.EMAIL_FROM) return env.EMAIL_FROM;
  return `${env.EMAIL_FROM_NAME} <${SANDBOX_SENDER}>`;
}

export const resendProvider: EmailProvider = {
  name: "resend",

  missingEnv() {
    return env.RESEND_API_KEY ? [] : ["RESEND_API_KEY"];
  },

  describeSender() {
    return sender();
  },

  async send(params: SendEmailParams): Promise<SentEmail> {
    const { data, error } = await getResendClient().emails.send({
      from: sender(),
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });

    // Resend resolves with { data, error } instead of throwing on API errors.
    if (error) {
      logger.error("Resend rejected an email", error);
      throw new Error(error.message ?? "Resend rejected the email");
    }

    return { messageId: data?.id ?? null };
  },
};
