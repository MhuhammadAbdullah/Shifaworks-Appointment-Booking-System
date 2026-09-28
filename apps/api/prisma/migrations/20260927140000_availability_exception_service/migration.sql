-- AlterTable
ALTER TABLE "availability_exceptions" ADD COLUMN     "serviceId" UUID;

-- CreateIndex
CREATE INDEX "availability_exceptions_serviceId_idx" ON "availability_exceptions"("serviceId");

-- AddForeignKey
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
