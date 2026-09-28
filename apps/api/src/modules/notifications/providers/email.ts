import { randomUUID } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { DeliveryError, type EmailMessage, type EmailProvider, type SendResult } from "./types.js";

const TIMEOUT_MS = 15_000;

/** SMTP (any mail server, Gmail/Workspace, SES/Mailgun/Brevo SMTP relays). */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";
  readonly configured = Boolean(env.SMTP_HOST);
  private transport: Transporter | null = null;

  private transporter(): Transporter {
    this.transport ??= nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? "" } : undefined,
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
      pool: true,
      maxConnections: 3,
    });
    return this.transport;
  }

  async send(m: EmailMessage): Promise<SendResult> {
    try {
      const info = await this.transporter().sendMail({
        from: env.EMAIL_FROM,
        to: m.to,
        subject: m.subject,
        html: m.html,
        text: m.text,
        replyTo: m.replyTo ?? env.EMAIL_REPLY_TO,
      });
      if (info.rejected?.length) throw new DeliveryError(`Rejected by the mail server: ${info.response}`, true, info.response);
      return { providerMessageId: info.messageId ?? null, response: info.response };
    } catch (err) {
      if (err instanceof DeliveryError) throw err;
      const e = err as { responseCode?: number; message?: string; code?: string };
      // SMTP 5xx = permanent (unknown mailbox, policy); 4xx and network errors = try again later.
      const permanent = typeof e.responseCode === "number" && e.responseCode >= 500;
      throw new DeliveryError(`SMTP: ${e.message ?? e.code ?? "send failed"}`, permanent, { code: e.code, responseCode: e.responseCode });
    }
  }
}

/** Resend (https://resend.com) over its HTTPS API. */
export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  readonly configured = Boolean(env.RESEND_API_KEY);

  async send(m: EmailMessage): Promise<SendResult> {
    let res: Response;
    try {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text, reply_to: m.replyTo ?? env.EMAIL_REPLY_TO }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new DeliveryError(`Resend unreachable: ${(err as Error).message}`, false);
    }
    const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!res.ok) {
      const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
      throw new DeliveryError(`Resend ${res.status}: ${body?.message ?? res.statusText}`, permanent, body);
    }
    return { providerMessageId: body?.id ?? null, response: body };
  }
}

/** Development: logs the message instead of sending it. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";
  readonly configured = true;

  async send(m: EmailMessage): Promise<SendResult> {
    logger.info({ email: { to: m.to, subject: m.subject, text: m.text.slice(0, 500) } }, "email (console provider; not sent)");
    return { providerMessageId: `console-${randomUUID()}` };
  }
}

export class DisabledEmailProvider implements EmailProvider {
  readonly name = "disabled";
  readonly configured = false;
  async send(): Promise<SendResult> {
    throw new DeliveryError("Email is not configured (EMAIL_PROVIDER)", true);
  }
}
