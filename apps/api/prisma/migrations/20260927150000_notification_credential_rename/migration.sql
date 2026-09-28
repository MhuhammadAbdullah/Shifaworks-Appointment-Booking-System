-- The invite-link column now carries the account's plaintext password (queued
-- at creation, rendered into the STAFF_INVITE email at send time), since the
-- self-service "click a link, then set your password" flow has been replaced
-- with admin-set / system-generated credentials sent directly by email.
ALTER TABLE "notifications" RENAME COLUMN "inviteLink" TO "credential";
