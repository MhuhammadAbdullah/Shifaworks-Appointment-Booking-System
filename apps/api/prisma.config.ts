import "dotenv/config";
import { defineConfig } from "prisma/config";

// The Prisma CLI (migrate, studio, db seed) must talk to Postgres directly.
// On Supabase that is the session/direct connection (port 5432), NOT the
// transaction pooler (6543) which the running API uses via DATABASE_URL.
const cliUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // `prisma generate` / `validate` / `migrate diff --from-empty` need no
    // connection, so allow the variable to be absent for those commands.
    url: cliUrl ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
