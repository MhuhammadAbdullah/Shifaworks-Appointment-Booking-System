/**
 * Serverless backstop for the two periodic jobs (jobs/scheduler.ts) — needed
 * only where nothing stays running between requests (Vercel). Vercel Cron
 * hits these on a schedule (vercel.json) with `Authorization: Bearer
 * $CRON_SECRET`, which it sends automatically once CRON_SECRET is set as a
 * project env var. On a traditional host (RUN_WORKERS=true) the in-process
 * scheduler already does this and these routes are simply never called.
 */
import { Router, type RequestHandler } from "express";
import { env } from "../../config/env.js";
import { dispatchDue } from "../notifications/dispatcher.js";
import { archiveOldLogs } from "../../jobs/log-archive.js";
import { sendOk } from "../../utils/api-response.js";
import { AppError } from "../../utils/app-error.js";

const requireCronSecret: RequestHandler = (req, _res, next) => {
  if (!env.CRON_SECRET || req.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    throw AppError.unauthenticated();
  }
  next();
};

export const cronRouter = Router();
cronRouter.use(requireCronSecret);

cronRouter.post("/dispatch", async (_req, res) => {
  sendOk(res, { handled: await dispatchDue() });
});

cronRouter.post("/log-archive", async (_req, res) => {
  sendOk(res, await archiveOldLogs());
});
