import { env } from "../../../config/env";
import { getSmtpTransport, type SmtpConfig } from "../../../config/smtp";
import { logger } from "../../../utils/logger";
import type {
  EmailProvider,
  SendEmailParams,
  SentEmail,
} from "./email-provider.interface";

/**
 * SMTP adapter, shared by every SMTP-speaking service. Two instances are
 * exported: a generic `smtp` one (host/port entirely from env) and a `gmail`
 * one that pre-fills Google's endpoint so the operator only has to supply
 * credentials.
 */

interface SmtpDefaults {
  name: string;
  host?: string;
  port?: number;
  /**
   * Gmail shows App Passwords in four 4-character groups ("abcd efgh ijkl
   * mnop") and they are almost always pasted with the spaces intact, but the
   * value SMTP AUTH expects has none — strip them rather than fail auth.
   */
  stripPasswordSpaces?: boolean;
}

/** Address portion of a "Name <addr>" header value, or the value as-is. */
function extractAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match?.[1] ?? from).trim();
}

function createSmtpProvider(defaults: SmtpDefaults): EmailProvider {
  /** Warn at most once per process; a per-send warning would flood the log. */
  let warnedFromMismatch = false;

  function password(): string | undefined {
    const raw = env.SMTP_PASSWORD;
    if (!raw) return undefined;
    return defaults.stripPasswordSpaces ? raw.replace(/\s+/g, "") : raw;
  }

  function host(): string | undefined {
    return env.SMTP_HOST ?? defaults.host;
  }

  function missingEnv(): string[] {
    const missing: string[] = [];
    if (!host()) missing.push("SMTP_HOST");
    if (!env.SMTP_USER) missing.push("SMTP_USER");
    if (!password()) missing.push("SMTP_PASSWORD");
    return missing;
  }

  function config(): SmtpConfig {
    const resolvedHost = host();
    const user = env.SMTP_USER;
    const pass = password();
    if (!resolvedHost || !user || !pass) {
      // Unreachable in practice: the service checks missingEnv() first.
      throw new Error(`SMTP is not configured (set ${missingEnv().join(", ")})`);
    }
    const port = env.SMTP_PORT ?? defaults.port ?? 587;
    return {
      host: resolvedHost,
      port,
      // Implicit TLS only on the submission-over-TLS port unless told otherwise;
      // 587 negotiates STARTTLS after connecting, which nodemailer does when
      // `secure` is false.
      secure: env.SMTP_SECURE ?? port === 465,
      user,
      password: pass,
    };
  }

  /**
   * Sender header. Without an EMAIL_FROM override we send as the authenticated
   * mailbox, which is the only address Gmail (and most providers) will accept.
   */
  function sender(): string | { name: string; address: string } {
    if (env.EMAIL_FROM) return env.EMAIL_FROM;
    return { name: env.EMAIL_FROM_NAME, address: env.SMTP_USER ?? "" };
  }

  return {
    name: defaults.name,
    missingEnv,

    describeSender() {
      const from = sender();
      return typeof from === "string" ? from : `${from.name} <${from.address}>`;
    },

    async send(params: SendEmailParams): Promise<SentEmail> {
      const smtp = config();

      // Sending as a foreign address is silently rewritten by some servers and
      // hard-rejected by others (Gmail: "Mail from must equal authorized user").
      if (
        !warnedFromMismatch &&
        env.EMAIL_FROM &&
        extractAddress(env.EMAIL_FROM).toLowerCase() !== smtp.user.toLowerCase()
      ) {
        warnedFromMismatch = true;
        logger.warn(
          `EMAIL_FROM (${extractAddress(env.EMAIL_FROM)}) is not the authenticated SMTP mailbox (${smtp.user}); ` +
            "most SMTP servers reject or rewrite this — leave EMAIL_FROM unset to send as SMTP_USER",
        );
      }

      const info = await getSmtpTransport(smtp).sendMail({
        from: sender(),
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
      });

      return { messageId: info.messageId ?? null };
    },
  };
}

/** Any SMTP server: host, port and credentials all come from env. */
export const smtpProvider = createSmtpProvider({ name: "smtp" });

/**
 * Gmail / Google Workspace. Requires an App Password (Google account → Security
 * → 2-Step Verification → App passwords); regular passwords have been rejected
 * since Google removed "less secure app access".
 */
export const gmailProvider = createSmtpProvider({
  name: "gmail",
  host: "smtp.gmail.com",
  port: 587,
  stripPasswordSpaces: true,
});
