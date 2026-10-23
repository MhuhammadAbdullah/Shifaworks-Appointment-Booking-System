import { describe, expect, it } from "vitest";
import { describeSmtpFailure } from "./email.js";

describe("describeSmtpFailure", () => {
  it("explains a timeout from a host that blocks outbound SMTP, and names the way out", () => {
    const text = describeSmtpFailure({ message: "Connection timeout", code: "ETIMEDOUT" }, "smtp.gmail.com", 587);
    expect(text).toContain("smtp.gmail.com:587");
    expect(text).toMatch(/block/i);
    expect(text).toContain("EMAIL_PROVIDER");
    expect(text).toContain("resend");
  });

  it("treats an unreachable IPv6 address, a refused connection and a missing greeting the same way", () => {
    for (const message of ["connect ENETUNREACH 2404:6800:4003:c05::6d:587 - Local (:::0)", "connect ECONNREFUSED 10.0.0.1:587", "Greeting never received"]) {
      expect(describeSmtpFailure({ message }, "smtp.example.com", 587), message).toContain("could not reach smtp.example.com:587");
    }
  });

  it("leaves errors that did reach the server (auth, rejected recipient, TLS) as they were", () => {
    expect(describeSmtpFailure({ message: "Invalid login: 535 5.7.8 Username and Password not accepted" }, "smtp.gmail.com", 587)).toBe(
      "SMTP: Invalid login: 535 5.7.8 Username and Password not accepted",
    );
    expect(describeSmtpFailure({ message: "Must issue a STARTTLS command first" }, "smtp.gmail.com", 465)).toBe("SMTP: Must issue a STARTTLS command first");
  });

  it("copes with a missing host and an error without a message", () => {
    expect(describeSmtpFailure({ code: "ETIMEDOUT" }, undefined, 25)).toContain("the mail server:25");
    expect(describeSmtpFailure({}, "h", 587)).toBe("SMTP: send failed");
  });
});
