import { env } from "../../../config/env.js";
import { ConsoleEmailProvider, DisabledEmailProvider, ResendEmailProvider, SmtpEmailProvider } from "./email.js";
import type { EmailProvider } from "./types.js";

export * from "./types.js";

let email: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (!email) {
    switch (env.EMAIL_PROVIDER) {
      case "smtp":
        email = new SmtpEmailProvider();
        break;
      case "resend":
        email = new ResendEmailProvider();
        break;
      case "console":
        email = new ConsoleEmailProvider();
        break;
      default:
        email = new DisabledEmailProvider();
    }
  }
  return email;
}

/** Tests swap in a fake; pass null to restore the configured provider. */
export function setEmailProviderForTest(p: EmailProvider | null): void {
  email = p;
}
