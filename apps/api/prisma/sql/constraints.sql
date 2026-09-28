-- =============================================================================
-- Integrity rules Prisma's schema language cannot express.
-- Applied as its own migration right after the initial schema migration.
-- =============================================================================

-- GiST support for "=" on uuid columns inside exclusion constraints.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- -----------------------------------------------------------------------------
-- 1. Double-booking protection (the last line of defence).
--    No two time-occupying appointments of the same provider may overlap,
--    buffers included. Half-open ranges: 10:00-11:00 and 11:00-12:00 are OK.
--    Status list must match ACTIVE_APPOINTMENT_STATUSES in @booking/shared.
-- -----------------------------------------------------------------------------
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_provider_overlap"
  EXCLUDE USING gist (
    "providerId" WITH =,
    tstzrange("blockedFrom", "blockedUntil", '[)') WITH &&
  )
  WHERE ("status" IN ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'));

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_time_order_chk"
    CHECK ("endsAt" > "startsAt"
       AND "blockedFrom" <= "startsAt"
       AND "blockedUntil" >= "endsAt"),
  ADD CONSTRAINT "appointments_amounts_chk"
    CHECK ("price" >= 0 AND "discountAmount" >= 0 AND "taxAmount" >= 0 AND "totalAmount" >= 0);

-- -----------------------------------------------------------------------------
-- 2. Event / ticket inventory can never go negative or exceed capacity.
--    Constraint names contain "capacity" so the API maps violations to
--    CAPACITY_EXCEEDED.
-- -----------------------------------------------------------------------------
ALTER TABLE "event_ticket_types"
  ADD CONSTRAINT "ticket_types_capacity_chk"
    CHECK ("capacity" >= 0
       AND "soldQuantity" >= 0
       AND "reservedQuantity" >= 0
       AND "soldQuantity" + "reservedQuantity" <= "capacity"),
  ADD CONSTRAINT "ticket_types_per_booking_chk"
    CHECK ("minPerBooking" >= 1 AND "maxPerBooking" >= "minPerBooking"),
  ADD CONSTRAINT "ticket_types_price_chk" CHECK ("price" >= 0);

ALTER TABLE "events"
  ADD CONSTRAINT "events_capacity_chk"
    CHECK ("soldCount" >= 0
       AND "reservedCount" >= 0
       AND ("capacity" IS NULL OR "soldCount" + "reservedCount" <= "capacity")),
  ADD CONSTRAINT "events_time_order_chk" CHECK ("endsAt" > "startsAt");

ALTER TABLE "event_bookings"
  ADD CONSTRAINT "event_bookings_quantity_chk" CHECK ("totalQuantity" > 0);

ALTER TABLE "event_booking_items"
  ADD CONSTRAINT "event_booking_items_quantity_chk" CHECK ("quantity" > 0 AND "unitPrice" >= 0);

-- -----------------------------------------------------------------------------
-- 3. Availability sanity.
-- -----------------------------------------------------------------------------
ALTER TABLE "availability_rules"
  ADD CONSTRAINT "availability_rules_day_chk" CHECK ("dayOfWeek" BETWEEN 1 AND 7),
  ADD CONSTRAINT "availability_rules_minutes_chk"
    CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute");

ALTER TABLE "availability_exceptions"
  ADD CONSTRAINT "availability_exceptions_dates_chk" CHECK ("endDate" >= "startDate"),
  ADD CONSTRAINT "availability_exceptions_minutes_chk"
    CHECK (
      ("type" = 'CUSTOM_HOURS'
        AND "startMinute" IS NOT NULL AND "endMinute" IS NOT NULL
        AND "startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute")
      OR ("type" <> 'CUSTOM_HOURS' AND "startMinute" IS NULL AND "endMinute" IS NULL)
    );

ALTER TABLE "availabilities"
  ADD CONSTRAINT "availabilities_dates_chk"
    CHECK ("effectiveFrom" IS NULL OR "effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");

ALTER TABLE "blocked_slots"
  ADD CONSTRAINT "blocked_slots_time_order_chk" CHECK ("endsAt" > "startsAt"),
  ADD CONSTRAINT "blocked_slots_target_chk" CHECK ("providerId" IS NOT NULL OR "locationId" IS NOT NULL);

-- -----------------------------------------------------------------------------
-- 4. Catalogue & money.
-- -----------------------------------------------------------------------------
ALTER TABLE "services"
  ADD CONSTRAINT "services_duration_chk"
    CHECK ("durationMinutes" > 0
       AND "bufferBeforeMinutes" >= 0
       AND "bufferAfterMinutes" >= 0
       AND ("slotIntervalMinutes" IS NULL OR "slotIntervalMinutes" > 0)
       AND "minNoticeMinutes" >= 0
       AND "maxAdvanceDays" > 0
       AND "maxParticipants" >= 1),
  ADD CONSTRAINT "services_price_chk"
    CHECK ("price" >= 0 AND "discountAmount" >= 0 AND "discountAmount" <= "price"
       AND "taxRatePercent" >= 0 AND "taxRatePercent" <= 100);

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_amounts_chk"
    CHECK ("subtotal" >= 0 AND "discountAmount" >= 0 AND "taxAmount" >= 0
       AND "totalAmount" >= 0 AND "amountPaid" >= 0);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amounts_chk"
    CHECK ("amount" > 0 AND "refundedAmount" >= 0 AND "refundedAmount" <= "amount");

ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_chk" CHECK ("amount" > 0);

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_amounts_chk"
    CHECK ("subtotal" >= 0 AND "discountAmount" >= 0 AND "taxAmount" >= 0
       AND "totalAmount" >= 0 AND "amountPaid" >= 0 AND "amountDue" >= 0);

ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_chk" CHECK ("amount" > 0);

ALTER TABLE "reminder_rules" ADD CONSTRAINT "reminder_rules_offset_chk" CHECK ("offsetMinutes" > 0);

-- NOTE: partial / expression indexes are deliberately NOT created here.
-- `prisma migrate dev` diffs the database against schema.prisma and would emit
-- DROP INDEX for indexes it cannot represent. Rules such as "one default
-- location per organization" and lower-cased emails are enforced in services.
-- Exclusion constraints, CHECK constraints and RLS are ignored by Prisma's
-- differ, so they are safe here.

-- Lowercase emails at the database level too (services normalise on write).
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase_chk" CHECK ("email" IS NULL OR "email" = lower("email"));

-- -----------------------------------------------------------------------------
-- 5. Supabase Data API lockdown.
--    Supabase exposes the public schema over PostgREST to anon/authenticated
--    keys. All data access goes through the Express API (which connects as the
--    table owner and therefore bypasses RLS), so enable RLS with NO policies:
--    browser keys can read/write nothing directly.
--    Every future migration that adds a table must also enable RLS on it.
-- -----------------------------------------------------------------------------
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
