import { databaseMigrationStatus, runMigrations } from "./migrations.js";

const statusOnly = process.argv.includes("--status");
try {
  const status = statusOnly ? await databaseMigrationStatus() : await runMigrations();
  console.log(JSON.stringify({ current: status.applied.at(-1) ?? null, ...status }, null, 2));
  if (status.pending.length) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
