-- AlterTable: package discounts (Phase 11)
ALTER TABLE "service_packages" ADD COLUMN "discountEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "service_packages" ADD COLUMN "discountPercent" DECIMAL(5,2);

-- AlterTable: digital-ticket check-in (Phase 11). checkInToken needs a DB-side default
-- (gen_random_uuid(), available by default on Supabase Postgres) purely to backfill any
-- existing rows for this NOT NULL/UNIQUE column — Prisma's own @default(uuid()) in the
-- schema is applied client-side on every future insert regardless.
ALTER TABLE "appointments" ADD COLUMN "checkInToken" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "appointments" ADD COLUMN "checkedInAt" TIMESTAMPTZ(3);
ALTER TABLE "appointments" ADD COLUMN "checkedInById" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "appointments_checkInToken_key" ON "appointments"("checkInToken");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_checkedInById_fkey" FOREIGN KEY ("checkedInById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
