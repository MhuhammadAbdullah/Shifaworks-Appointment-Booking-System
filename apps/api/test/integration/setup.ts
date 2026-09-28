// Load apps/api/.env before any module reads process.env.
import "dotenv/config";

process.env.LOG_LEVEL ??= "silent";
if (process.env.LOG_LEVEL !== "silent") process.env.LOG_LEVEL = "error";

// Integration tests run with NODE_ENV=development (the real dev config), not
// "test", so the notification dispatcher's `!isTest` auto-dispatch guard
// doesn't apply here. Without this, every booking created by any integration
// test would schedule a real ~1s-later dispatch timer that can fire after a
// test file's own afterAll() has already disconnected Prisma. Tests that care
// about delivery call dispatchDue()/deliverNotification() explicitly.
const { setAutoDispatch } = await import("../../src/modules/notifications/dispatcher.js");
setAutoDispatch(false);
