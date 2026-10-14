-- "Areas of concern" move from the service to each provider.
-- Additive: the old service_concern_options table is left untouched (nothing writes to it any more),
-- so this migration can be applied before the new code is deployed and old code keeps working.

-- CreateTable
CREATE TABLE "provider_concern_options" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_concern_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_concern_options_providerId_isActive_sortOrder_idx" ON "provider_concern_options"("providerId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "provider_concern_options_providerId_code_key" ON "provider_concern_options"("providerId", "code");

-- AddForeignKey
ALTER TABLE "provider_concern_options" ADD CONSTRAINT "provider_concern_options_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "provider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Starting point: every provider gets the options of each service it offers, with the same codes,
-- labels, order and visibility, so the booking forms look exactly as before until someone edits a
-- provider's list. A provider offering two checklist services keeps one row per code (the lower sort order wins).
INSERT INTO "provider_concern_options" ("id", "providerId", "code", "label", "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT DISTINCT ON (sp."providerId", sco."code")
    gen_random_uuid(), sp."providerId", sco."code", sco."label", sco."isActive", sco."sortOrder", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "service_concern_options" sco
JOIN "service_providers" sp ON sp."serviceId" = sco."serviceId"
ORDER BY sp."providerId", sco."code", sco."sortOrder";
