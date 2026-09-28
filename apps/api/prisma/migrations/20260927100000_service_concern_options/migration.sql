-- CreateTable
CREATE TABLE "service_concern_options" (
    "id" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_concern_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_concern_options_serviceId_isActive_sortOrder_idx" ON "service_concern_options"("serviceId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "service_concern_options_serviceId_code_key" ON "service_concern_options"("serviceId", "code");

-- AddForeignKey
ALTER TABLE "service_concern_options" ADD CONSTRAINT "service_concern_options_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
