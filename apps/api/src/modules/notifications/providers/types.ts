/** Channel provider contract. Adding a vendor = one class + one registry line. */

export interface SendResult {
  providerMessageId: string | null;
  response?: unknown;
}

/**
 * A failed send. `permanent` failures (bad address, rejected template) are
 * never retried; transient ones (timeouts, 5xx, rate limits) are retried with
 * backoff until MAX_NOTIFICATION_ATTEMPTS.
 */
export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
    readonly response?: unknown,
  ) {
    super(message);
    this.name = "DeliveryError";
  }
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | undefined;
}

export interface EmailProvider {
  readonly name: string;
  readonly configured: boolean;
  send(message: EmailMessage): Promise<SendResult>;
}
