-- CreateEnum: CUSTOMER = existing billing invoices, PROVIDER = therapist/counsellor pay-slips
CREATE TYPE "InvoiceAudience" AS ENUM ('CUSTOMER', 'PROVIDER');

-- AlterTable: customerId becomes optional (PROVIDER-audience rows have no customer),
-- providerId added for PROVIDER-audience rows, audience defaults to the existing behavior.
ALTER TABLE "invoices" ADD COLUMN     "audience" "InvoiceAudience" NOT NULL DEFAULT 'CUSTOMER',
ADD COLUMN     "providerId" UUID,
ALTER COLUMN "customerId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "invoices_providerId_idx" ON "invoices"("providerId");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "provider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
