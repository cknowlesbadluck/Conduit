import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

export type Migration = { version: string; file: string };
export type MigrationStatus = { required: string[]; applied: string[]; pending: string[] };
export type MigrationClient = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };

export const MIGRATIONS: readonly Migration[] = [
  { version: "0.7.1", file: "0.7.1.sql" },
  { version: "0.8.1-drop-agent-id-unique", file: "0.8.1-drop-agent-id-unique.sql" },
  { version: "0.8.2-tombstones", file: "0.8.2-tombstones.sql" },
  { version: "0.8.3-contact-tool-tombstones", file: "0.8.3-contact-tool-tombstones.sql" },
  { version: "0.8.4-capability-grants", file: "0.8.4-capability-grants.sql" },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.at(-1)!.version;
const LOCK_SQL = "SELECT pg_advisory_lock(hashtext('conduit-schema-migrations'))";
const UNLOCK_SQL = "SELECT pg_advisory_unlock(hashtext('conduit-schema-migrations'))";
const CREATE_TABLE_SQL = "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())";

export function validateMigrationList(migrations: readonly Migration[]): void {
  const seen = new Set<string>();
  for (const migration of migrations) {
    if (seen.has(migration.version)) throw new Error(`duplicate_migration_identifier:${migration.version}`);
    seen.add(migration.version);
  }
}

async function appliedVersions(client: MigrationClient): Promise<string[]> {
  return (await client.query("SELECT version FROM schema_migrations ORDER BY applied_at, version")).rows.map(row => String(row.version));
}

function statusFor(applied: string[], migrations = MIGRATIONS): MigrationStatus {
  validateMigrationList(migrations);
  const required = migrations.map(m => m.version);
  const known = new Set(required);
  const unknown = applied.filter(version => !known.has(version));
  if (unknown.length) throw new Error(`unknown_database_migration:${unknown.join(",")}`);
  const present = new Set(applied);
  return { required, applied, pending: required.filter(version => !present.has(version)) };
}

export async function migrateClient(client: MigrationClient, loadSql: (migration: Migration) => Promise<string>): Promise<MigrationStatus> {
  validateMigrationList(MIGRATIONS);
  // The bookkeeping table must precede the lock so an entirely empty database can migrate.
  await client.query(CREATE_TABLE_SQL);
  await client.query(LOCK_SQL);
  try {
    const initial = statusFor(await appliedVersions(client));
    for (const version of initial.pending) {
      const migration = MIGRATIONS.find(item => item.version === version)!;
      await client.query("BEGIN");
      try {
        await client.query(await loadSql(migration));
        await client.query("INSERT INTO schema_migrations(version) VALUES($1)", [version]);
        await client.query("COMMIT");
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch { /* preserve the migration error */ }
        throw error;
      }
    }
    return statusFor(await appliedVersions(client));
  } finally {
    await client.query(UNLOCK_SQL);
  }
}

export async function validateSchema(client: MigrationClient): Promise<MigrationStatus> {
  // Deliberately no CREATE/ALTER: normal service startup needs read privileges only.
  try { return statusFor(await appliedVersions(client)); }
  catch (error) {
    if ((error as { code?: string }).code === "42P01") throw new Error(`schema_not_migrated: run npm run migrate`, { cause: error });
    throw error;
  }
}

export function createDatabasePool(max = 2): pg.Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  return new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true" }, max });
}

export async function runMigrations(): Promise<MigrationStatus> {
  const pool = createDatabasePool(1);
  const client = await pool.connect();
  try { return await migrateClient(client, migration => readFile(resolve(process.cwd(), "migrations", migration.file), "utf8")); }
  finally { client.release(); await pool.end(); }
}

export async function databaseMigrationStatus(): Promise<MigrationStatus> {
  const pool = createDatabasePool(1);
  try { return await validateSchema(pool); }
  finally { await pool.end(); }
}
