-- Provider deletion no longer hard-removes a row once it has appointments
-- (their bookings/payments/invoices keep a real, non-nullable providerId to
-- point at); deletedAt marks it hidden everywhere instead.
ALTER TABLE "provider_profiles" ADD COLUMN "deletedAt" TIMESTAMPTZ(3);
