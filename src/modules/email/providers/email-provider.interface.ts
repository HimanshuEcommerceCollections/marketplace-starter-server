/**
 * Provider-agnostic email port. The email service (and therefore every caller:
 * auth verification, booking notifications) depends on this interface, never on
 * a concrete SDK or transport, so switching Gmail → SES → Postmark → Resend is
 * a new adapter plus one env var, with zero changes to the service layer.
 *
 * Mirrors modules/payments/providers/payment-provider.interface.ts.
 */

export interface SendEmailParams {
  /** Single recipient address. */
  to: string;
  subject: string;
  /** Rich body; every adapter is expected to send html + text together. */
  html: string;
  /** Plain-text alternative, for clients that refuse HTML and for spam scoring. */
  text: string;
}

export interface SentEmail {
  /** Provider message id when it exposes one, for log correlation. */
  messageId: string | null;
}

export interface EmailProvider {
  /** Registry key, also the value accepted by EMAIL_PROVIDER. */
  readonly name: string;

  /**
   * Env var names this adapter needs that are currently unset. Empty means
   * ready to send; anything else is reported verbatim in the 501 the service
   * raises, so the operator is told exactly what to configure.
   */
  missingEnv(): string[];

  /** The address this adapter sends as, for boot-time logging. */
  describeSender(): string;

  /**
   * Deliver one message. Rejects on transport/API failure; callers decide
   * whether that is fatal (it is not for signup or notifications, which log and
   * continue).
   */
  send(params: SendEmailParams): Promise<SentEmail>;
}
