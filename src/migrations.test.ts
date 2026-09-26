import assert from "node:assert/strict";
import test from "node:test";
import { MIGRATIONS, migrateClient, validateMigrationList, validateSchema, type MigrationClient } from "./migrations.js";

class FakeDatabase {
  applied: string[];
  executions: string[] = [];
  private tail = Promise.resolve();
  constructor(applied: string[] = []) { this.applied = [...applied]; }
  client(): MigrationClient {
    let unlock: (() => void) | undefined;
    let staged: string[] = [];
    return { query: async (sql, values = []) => {
      if (sql.includes("pg_advisory_lock")) {
        const previous = this.tail;
        this.tail = new Promise<void>(resolve => { unlock = resolve; });
        await previous;
      } else if (sql.includes("pg_advisory_unlock")) unlock?.();
      else if (sql === "BEGIN") staged = [];
      else if (sql === "COMMIT") { this.applied.push(...staged); staged = []; }
      else if (sql === "ROLLBACK") staged = [];
      else if (sql.startsWith("SELECT version")) return { rows: this.applied.map(version => ({ version })) };
      else if (sql.startsWith("INSERT INTO schema_migrations")) staged.push(String(values[0]));
      else if (!sql.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations")) this.executions.push(sql);
      return { rows: [] };
    } };
  }
}

const sql = async ({ version }: { version: string }) => `migration:${version}`;

test("migrates an empty database in manifest order and repeated execution is a no-op", async () => {
  const database = new FakeDatabase();
  const first = await migrateClient(database.client(), sql);
  assert.deepEqual(first.applied, MIGRATIONS.map(m => m.version));
  assert.deepEqual(database.executions, MIGRATIONS.map(m => `migration:${m.version}`));
  await migrateClient(database.client(), sql);
  assert.equal(database.executions.length, MIGRATIONS.length);
});

test("upgrades a representative pre-0.8 database without replaying its baseline", async () => {
  const database = new FakeDatabase(["0.7.1"]);
  await migrateClient(database.client(), sql);
  assert.deepEqual(database.executions, MIGRATIONS.slice(1).map(m => `migration:${m.version}`));
});

test("does not record a migration that fails", async () => {
  const database = new FakeDatabase();
  await assert.rejects(migrateClient(database.client(), async migration => {
    if (migration.version === MIGRATIONS[1].version) throw new Error("broken migration");
    return `migration:${migration.version}`;
  }), /broken migration/);
  assert.deepEqual(database.applied, [MIGRATIONS[0].version]);
});

test("serializes concurrent runners with the advisory lock", async () => {
  const database = new FakeDatabase();
  await Promise.all([migrateClient(database.client(), sql), migrateClient(database.client(), sql)]);
  assert.deepEqual(database.applied, MIGRATIONS.map(m => m.version));
  assert.equal(database.executions.length, MIGRATIONS.length);
});

test("rejects unknown database versions and duplicate manifest identifiers", async () => {
  await assert.rejects(validateSchema(new FakeDatabase(["future-version"]).client()), /unknown_database_migration:future-version/);
  assert.throws(() => validateMigrationList([{ version: "same", file: "a" }, { version: "same", file: "b" }]), /duplicate_migration_identifier:same/);
});
