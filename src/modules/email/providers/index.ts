import { env } from "../../../config/env";
import { ApiError } from "../../../utils/api-error";
import type { EmailProvider } from "./email-provider.interface";
import { gmailProvider, smtpProvider } from "./smtp.provider";
import { resendProvider } from "./resend.provider";

/**
 * Adapter registry. Add new transports (SES, Postmark, Mailgun API, …) to this
 * map and to the EMAIL_PROVIDER enum in config/env.ts; everything above this
 * layer stays provider-agnostic.
 *
 * Mirrors modules/payments/providers/index.ts.
 */
const providers: Record<string, EmailProvider> = {
  [gmailProvider.name]: gmailProvider,
  [smtpProvider.name]: smtpProvider,
  [resendProvider.name]: resendProvider,
};

/** Resolve the active adapter (EMAIL_PROVIDER) or an explicitly named one. */
export function resolveEmailProvider(name: string = env.EMAIL_PROVIDER): EmailProvider {
  const provider = providers[name.trim().toLowerCase()];
  if (!provider) {
    // EMAIL_PROVIDER is enum-validated at boot, so this only fires for an
    // explicitly passed name.
    throw ApiError.notFound(`Unknown email provider: ${name}`);
  }
  return provider;
}

export type {
  EmailProvider,
  SendEmailParams,
  SentEmail,
} from "./email-provider.interface";
