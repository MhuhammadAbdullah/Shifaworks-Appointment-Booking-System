/**
 * Verifies that the hand-written database guarantees are in place.
 *   npx tsx --env-file=.env scripts/verify-db.ts
 */
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });

async function main() {
  await client.connect();
  const migrations = await client.query<{ migration_name: string; finished_at: Date | null }>(
    `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at`,
  );
  console.log("migrations:");
  for (const m of migrations.rows) console.log(`  ${m.migration_name}  ${m.finished_at ? "applied" : "FAILED"}`);

  const overlap = await client.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'appointments_no_provider_overlap' AND contype = 'x'`,
  );
  console.log(`exclusion constraint: ${overlap.rowCount === 1 ? "present" : "MISSING"}`);

  const checks = await client.query(
    `SELECT count(*)::int AS n FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public' AND c.contype = 'c'`,
  );
  console.log(`check constraints: ${checks.rows[0].n}`);

  const rls = await client.query<{ relname: string }>(
    `SELECT relname FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
        AND NOT relrowsecurity AND relname <> '_prisma_migrations'`,
  );
  console.log(`tables without RLS: ${rls.rowCount === 0 ? "none" : rls.rows.map((r) => r.relname).join(", ")}`);
  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  await client.end().catch(() => undefined);
  process.exitCode = 1;
});
