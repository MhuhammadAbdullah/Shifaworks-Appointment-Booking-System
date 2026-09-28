import { z } from "zod";

/**
 * Browser-safe configuration. Only NEXT_PUBLIC_* variables may appear here:
 * they are inlined into the client bundle. Server secrets (service-role key,
 * DB URLs) belong to apps/api and must never be referenced from apps/web.
 *
 * Each variable is referenced literally so Next.js can inline it.
 */
const PublicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  // Supabase publishable/anon key: safe for browsers because every table has
  // RLS enabled with no policies and all data flows through the API.
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_DEFAULT_TIMEZONE: z.string().default("Asia/Karachi"),
  // The main (WordPress) website: service discovery happens there.
  NEXT_PUBLIC_WEBSITE_URL: z.url().default("https://shifaworks.com"),
});

export const publicEnv = PublicEnvSchema.parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_DEFAULT_TIMEZONE: process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE,
  NEXT_PUBLIC_WEBSITE_URL: process.env.NEXT_PUBLIC_WEBSITE_URL,
});
