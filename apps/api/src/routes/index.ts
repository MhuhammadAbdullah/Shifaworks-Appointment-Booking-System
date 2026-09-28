import { Router } from "express";
import { healthRouter } from "../modules/health/health.routes.js";
import { authRouter } from "../modules/auth/auth.routes.js";
import { usersRouter } from "../modules/users/users.routes.js";
import { permissionsRouter, rolesRouter } from "../modules/roles/roles.routes.js";
import { staffRouter } from "../modules/staff/staff.routes.js";
import { servicesRouter } from "../modules/services/services.routes.js";
import { providersRouter } from "../modules/providers/providers.routes.js";
import { availabilityRouter } from "../modules/availability/availability.routes.js";
import { filesRouter } from "../modules/files/files.routes.js";
import { publicRouter } from "../modules/public/public.routes.js";
import { bookingsRouter } from "../modules/appointments/bookings.routes.js";
import { paymentsRouter } from "../modules/payments/payments.routes.js";
import { invoicesRouter } from "../modules/invoices/invoices.routes.js";
import { financeRouter } from "../modules/finance/finance.routes.js";
import { emailTemplatesRouter, notificationsRouter } from "../modules/notifications/notifications.routes.js";
import { reportsRouter } from "../modules/reports/reports.routes.js";
import { auditRouter } from "../modules/audit/audit.routes.js";
import { settingsRouter } from "../modules/settings/settings.routes.js";
import { checkinRouter } from "../modules/checkin/checkin.routes.js";
import { cronRouter } from "../modules/cron/cron.routes.js";

/**
 * /api/v1 router. Modules are mounted here as their phase lands
 * (see docs/ARCHITECTURE.md §4 for the full contract):
 *   Phase 2  /auth /users /roles /permissions /staff  (mounted)
 *   Phase 3  /services /providers /availability /files  (mounted)
 *   Phase 4  /public/* — the booking forms' unauthenticated, rate-limited endpoints  (mounted)
 *   Phase 5  /bookings — manual booking, cancel/reschedule/complete/no-show  (mounted)
 *   Phase 6  /payments /invoices /finance  (mounted)
 *   Phase 7  /notifications /notifications/templates  (mounted)
 *   Phase 8  skipped — the event system was removed from scope
 *   Phase 9  /reports /audit-logs /admin/settings  (mounted; no dedicated /dashboard —
 *            the admin and provider dashboards compose the existing /bookings and
 *            /notifications list endpoints instead of duplicating them)
 *   Phase 11 /check-in — digital-ticket QR + manual check-in (mounted)
 */
export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/users", usersRouter);
apiRouter.use("/roles", rolesRouter);
apiRouter.use("/permissions", permissionsRouter);
apiRouter.use("/staff", staffRouter);
apiRouter.use("/services", servicesRouter);
apiRouter.use("/providers", providersRouter);
apiRouter.use("/availability", availabilityRouter);
apiRouter.use("/files", filesRouter);
apiRouter.use("/public", publicRouter);
apiRouter.use("/bookings", bookingsRouter);
apiRouter.use("/payments", paymentsRouter);
apiRouter.use("/invoices", invoicesRouter);
apiRouter.use("/finance", financeRouter);
apiRouter.use("/notifications/templates", emailTemplatesRouter);
apiRouter.use("/notifications", notificationsRouter);
apiRouter.use("/reports", reportsRouter);
apiRouter.use("/audit-logs", auditRouter);
apiRouter.use("/admin/settings", settingsRouter);
apiRouter.use("/check-in", checkinRouter);
apiRouter.use("/internal/cron", cronRouter);
