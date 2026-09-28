import { describe, expect, it } from "vitest";
import { getPgConstraint, getPgErrorCode, isExclusionViolation } from "./db-errors.js";

/** Shape observed from Prisma 7.10 + @prisma/adapter-pg for a constraint violation. */
function prismaAdapterError(sqlState: string, message: string) {
  return {
    name: "PrismaClientKnownRequestError",
    code: "P2039",
    message: `Database error. Code: \`${sqlState}\`. Message: \`${message}\``,
    meta: {
      modelName: "Appointment",
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: { originalCode: sqlState, originalMessage: message, kind: "postgres", code: sqlState },
      },
    },
  };
}

describe("db error helpers", () => {
  it("finds the SQLSTATE beneath Prisma's own P-code (regression)", () => {
    const err = prismaAdapterError("23P01", 'conflicting key value violates exclusion constraint "appointments_no_provider_overlap"');
    expect(getPgErrorCode(err)).toBe("23P01");
    expect(isExclusionViolation(err)).toBe(true);
    expect(getPgConstraint(err)).toBe("appointments_no_provider_overlap");
  });

  it("reads plain pg driver errors", () => {
    expect(getPgErrorCode({ code: "23505", constraint: "users_email_key" })).toBe("23505");
  });

  it("returns undefined for non-database errors", () => {
    expect(getPgErrorCode(new Error("boom"))).toBeUndefined();
    expect(getPgErrorCode({ code: "P2025" })).toBeUndefined();
  });
});
