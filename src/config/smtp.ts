import nodemailer, { type Transporter } from "nodemailer";

/**
 * Lazily-constructed nodemailer transports, cached per resolved connection so
 * the SMTP handshake is not repeated for every message. Built on first use (not
 * at import time) so the app still boots in environments without mail
 * credentials (dev/test): email-dependent flows respond 501 until SMTP_USER /
 * SMTP_PASSWORD are present. Mirrors the shape of config/stripe.ts.
 */

export interface SmtpConfig {
  host: string;
  port: number;
  /** true = implicit TLS (port 465); false = STARTTLS upgrade (port 587). */
  secure: boolean;
  user: string;
  password: string;
}

const transports = new Map<string, Transporter>();

export function getSmtpTransport(config: SmtpConfig): Transporter {
  const key = `${config.host}:${config.port}:${config.secure}:${config.user}`;
  let transport = transports.get(key);

  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.password },
      // Verification mail is sent inside the signup request, so an unreachable
      // mail server must fail fast rather than hold the connection open for
      // nodemailer's multi-minute defaults.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    transports.set(key, transport);
  }

  return transport;
}
