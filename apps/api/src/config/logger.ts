import { pino } from "pino";
import { env, isProduction } from "./env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "booking-api" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "*.password",
      "*.token",
      "*.accessToken",
      "*.refreshToken",
      "*.secret",
    ],
    censor: "[REDACTED]",
  },
  // pino-pretty spawns a worker thread that needs its own file on disk — unavailable in a
  // bundled serverless function, so it's gated on more than just isProduction: if NODE_ENV
  // isn't actually set to "production" on a host like Vercel (process.env.VERCEL is set
  // there regardless of NODE_ENV), pino-pretty would crash the process on every cold start.
  ...(isProduction || process.env.VERCEL
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname,service" },
        },
      }),
});

export type Logger = typeof logger;
