/**
 * Vercel entry point for every /api/* request. A dynamic catch-all file (rather than a
 * custom `rewrites` rule in vercel.json) because Vercel now rewrites the request's routing
 * path to the rewrite *destination* before invoking the function, which broke Express's own
 * "/api/v1" mounting (every request 404'd). This file-system catch-all route preserves the
 * real incoming path, so Express's router sees what the client actually requested.
 * No .listen() and no startScheduler() here — nothing stays running between invocations on
 * serverless, so periodic jobs run via Vercel Cron hitting /api/v1/internal/cron/* instead
 * (modules/cron/cron.routes.ts).
 */
import { createApp } from "../src/app.js";

export default createApp();
