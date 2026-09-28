-- Event system rows (email templates seeded for it) are deleted before the enum swap below,
-- since a value not present in the new enum cannot survive the USING cast.
DELETE FROM "email_templates" WHERE "key" IN ('EVENT_BOOKING_RECEIVED', 'EVENT_BOOKING_CONFIRMED');

-- AlterEnum
CREATE TYPE "BookingType_new" AS ENUM ('APPOINTMENT');
ALTER TABLE "bookings" ALTER COLUMN "type" TYPE "BookingType_new" USING ("type"::text::"BookingType_new");
ALTER TYPE "BookingType" RENAME TO "BookingType_old";
ALTER TYPE "BookingType_new" RENAME TO "BookingType";
DROP TYPE "public"."BookingType_old";

-- AlterEnum
CREATE TYPE "EmailTemplateKey_new" AS ENUM ('BOOKING_RECEIVED', 'BOOKING_CONFIRMED', 'PAYMENT_REJECTED', 'BOOKING_CANCELLED', 'BOOKING_RESCHEDULED');
ALTER TABLE "email_templates" ALTER COLUMN "key" TYPE "EmailTemplateKey_new" USING ("key"::text::"EmailTemplateKey_new");
ALTER TABLE "notifications" ALTER COLUMN "templateKey" TYPE "EmailTemplateKey_new" USING ("templateKey"::text::"EmailTemplateKey_new");
ALTER TYPE "EmailTemplateKey" RENAME TO "EmailTemplateKey_old";
ALTER TYPE "EmailTemplateKey_new" RENAME TO "EmailTemplateKey";
DROP TYPE "public"."EmailTemplateKey_old";

-- DropForeignKey
ALTER TABLE "event_attendees" DROP CONSTRAINT "event_attendees_eventBookingId_fkey";

-- DropForeignKey
ALTER TABLE "event_attendees" DROP CONSTRAINT "event_attendees_eventId_fkey";

-- DropForeignKey
ALTER TABLE "event_attendees" DROP CONSTRAINT "event_attendees_ticketTypeId_fkey";

-- DropForeignKey
ALTER TABLE "event_booking_items" DROP CONSTRAINT "event_booking_items_eventBookingId_fkey";

-- DropForeignKey
ALTER TABLE "event_booking_items" DROP CONSTRAINT "event_booking_items_ticketTypeId_fkey";

-- DropForeignKey
ALTER TABLE "event_bookings" DROP CONSTRAINT "event_bookings_bookingId_fkey";

-- DropForeignKey
ALTER TABLE "event_bookings" DROP CONSTRAINT "event_bookings_eventId_fkey";

-- DropForeignKey
ALTER TABLE "event_check_ins" DROP CONSTRAINT "event_check_ins_attendeeId_fkey";

-- DropForeignKey
ALTER TABLE "event_check_ins" DROP CONSTRAINT "event_check_ins_eventId_fkey";

-- DropForeignKey
ALTER TABLE "event_check_ins" DROP CONSTRAINT "event_check_ins_scannedById_fkey";

-- DropForeignKey
ALTER TABLE "event_ticket_types" DROP CONSTRAINT "event_ticket_types_eventId_fkey";

-- DropForeignKey
ALTER TABLE "events" DROP CONSTRAINT "events_imageId_fkey";

-- DropForeignKey
ALTER TABLE "events" DROP CONSTRAINT "events_locationId_fkey";

-- DropForeignKey
ALTER TABLE "events" DROP CONSTRAINT "events_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "invoice_items" DROP CONSTRAINT "invoice_items_ticketTypeId_fkey";

-- AlterTable
ALTER TABLE "invoice_items" DROP COLUMN "ticketTypeId";

-- DropTable
DROP TABLE "event_attendees";

-- DropTable
DROP TABLE "event_booking_items";

-- DropTable
DROP TABLE "event_bookings";

-- DropTable
DROP TABLE "event_check_ins";

-- DropTable
DROP TABLE "event_ticket_types";

-- DropTable
DROP TABLE "events";

-- DropEnum
DROP TYPE "AttendeeStatus";

-- DropEnum
DROP TYPE "CheckInResult";

-- DropEnum
DROP TYPE "EventStatus";
