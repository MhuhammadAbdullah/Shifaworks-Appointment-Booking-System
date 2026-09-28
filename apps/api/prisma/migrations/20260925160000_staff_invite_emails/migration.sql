-- AlterEnum: new template key + audience for admin-manageable staff/provider invite emails,
-- replacing Supabase Auth's own default invite/recovery emails.
ALTER TYPE "EmailTemplateKey" ADD VALUE 'STAFF_INVITE';
ALTER TYPE "NotificationAudience" ADD VALUE 'STAFF';

-- AlterTable: userId (in place of bookingId) + inviteLink for account-level messages that
-- aren't about a booking — see the schema comments on Notification.userId/inviteLink.
ALTER TABLE "notifications" ADD COLUMN "userId" UUID;
ALTER TABLE "notifications" ADD COLUMN "inviteLink" TEXT;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
