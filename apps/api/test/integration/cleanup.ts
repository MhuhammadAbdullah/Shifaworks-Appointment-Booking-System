import { prisma } from "../../src/lib/prisma.js";

/**
 * Guards a cleanup delete. Prisma treats `{ id: undefined }` as "no filter",
 * so a fixture id that was never set (setup failed half-way) would turn
 * `deleteMany({ where: { eventId } })` into "delete every row". Returns false
 * (skip) when any id is missing, so cleanup only ever touches rows the test
 * created. Use: `if (ids(eventId)) await prisma.event.deleteMany(...)`.
 */
export function ids(...values: (string | null | undefined)[]): boolean {
  return values.length > 0 && values.every((v) => typeof v === "string" && v.length > 0);
}

/**
 * Removes notifications (and their email logs) belonging to the given test
 * bookings. Call before deleting the bookings. Scoped by id list only.
 */
export async function deleteTestNotifications(bookingIds: string[]): Promise<void> {
  if (!bookingIds.length) return;
  const rows = await prisma.notification.findMany({ where: { bookingId: { in: bookingIds } }, select: { id: true } });
  const idsToDelete = rows.map((r) => r.id);
  if (!idsToDelete.length) return;
  await prisma.emailLog.deleteMany({ where: { notificationId: { in: idsToDelete } } });
  await prisma.notification.deleteMany({ where: { id: { in: idsToDelete } } });
}
