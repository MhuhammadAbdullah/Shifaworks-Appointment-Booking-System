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
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname,service" },
        },
      }),
});

export type Logger = typeof logger;
