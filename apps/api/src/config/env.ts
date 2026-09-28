import { z } from "zod";

const booleanString = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const csv = z
  .string()
  .transform((v) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // Number of reverse proxies in front of the API (load balancer, Render, etc.)
  // so req.ip and rate limiting see the real client address.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),

  CORS_ORIGINS: csv.default(["http://localhost:3000"]),
  APP_URL: z.url().default("http://localhost:3000"),
  API_URL: z.url().default("http://localhost:4000"),

  // Runtime connection (Supabase transaction pooler, port 6543).
  DATABASE_URL: z.string().min(1),
  // Direct/session connection for migrations (used by prisma.config.ts only).
  DIRECT_URL: z.string().min(1).optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  SUPABASE_URL: z.url(),
  // Server-only secret. Never sent to the browser.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_ISSUER: z.string().optional(),
  SUPABASE_JWT_AUDIENCE: z.string().default("authenticated"),
  // Only needed for projects still on the legacy HS256 shared JWT secret.
  SUPABASE_JWT_SECRET: z.string().optional(),
  STORAGE_PUBLIC_BUCKET: z.string().default("public-media"),
  STORAGE_PRIVATE_BUCKET: z.string().default("private-files"),
  STORAGE_ARCHIVE_BUCKET: z.string().default("log-archives"),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
  // Audit logs / email logs older than this are exported to CSV in STORAGE_ARCHIVE_BUCKET and deleted weekly.
  LOG_ARCHIVE_RETENTION_DAYS: z.coerce.number().int().positive().default(14),

  REDIS_URL: z.string().optional(),
  QUEUE_ENABLED: booleanString.default(false),
  // Run queue workers and schedulers inside the API process. Set false when a
  // separate `npm run worker` process does that work.
  RUN_WORKERS: booleanString.default(true),

  // --- Email ------------------------------------------------------------------
  // "console" logs messages instead of sending them (development default).
  // Support contacts, payment instructions and admin recipients are admin
  // settings (database), not environment variables.
  EMAIL_PROVIDER: z.enum(["smtp", "resend", "console", "disabled"]).optional(),
  EMAIL_FROM: z.string().default("ShifaWorks <no-reply@shifaworks.com>"),
  EMAIL_REPLY_TO: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: booleanString.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  // Country calling code used to turn local numbers (03001234567) into E.164.
  DEFAULT_PHONE_COUNTRY_CODE: z.string().regex(/^\d{1,3}$/).default("92"),

  DEFAULT_ORGANIZATION_SLUG: z.string().default("shifaworks"),
  // HMAC key for QR ticket payloads and other signed tokens.
  APP_SIGNING_SECRET: z.string().min(32),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  // Public booking-form submissions allowed per IP per hour (spam protection).
  PUBLIC_BOOKING_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(10),
});

/** The email provider is always resolved after loading. */
export type Env = z.infer<typeof EnvSchema> & Required<Pick<z.infer<typeof EnvSchema>, "EMAIL_PROVIDER">>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    // Logger depends on env, so fail loudly on stderr before anything starts.
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  const env = parsed.data as Env;
  if (env.QUEUE_ENABLED && !env.REDIS_URL) {
    console.error("QUEUE_ENABLED=true requires REDIS_URL");
    process.exit(1);
  }
  const production = env.NODE_ENV === "production";
  // Production never silently "sends" to the console: channels are off until configured.
  env.EMAIL_PROVIDER ??= production ? "disabled" : "console";
  const missing: string[] = [];
  if (env.EMAIL_PROVIDER === "smtp" && !env.SMTP_HOST) missing.push("SMTP_HOST (EMAIL_PROVIDER=smtp)");
  if (env.EMAIL_PROVIDER === "resend" && !env.RESEND_API_KEY) missing.push("RESEND_API_KEY (EMAIL_PROVIDER=resend)");
  if (missing.length) {
    console.error(`Invalid environment configuration:\n${missing.map((m) => `  - missing ${m}`).join("\n")}`);
    process.exit(1);
  }
  return env;
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
