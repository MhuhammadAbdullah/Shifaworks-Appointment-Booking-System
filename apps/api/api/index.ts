/**
 * Vercel entry point: exports the Express app directly as the request
 * handler for every path (see ../vercel.json's catch-all rewrite). No
 * .listen() and no startScheduler() here — nothing stays running between
 * invocations on serverless, so periodic jobs run via Vercel Cron hitting
 * /api/v1/internal/cron/* instead (modules/cron/cron.routes.ts).
 */
import { createApp } from "../src/app.js";

export default createApp();
