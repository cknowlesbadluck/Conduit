import pg from "pg";
import { postgresSsl } from "./db-ssl.js";

export async function checkPersistence(): Promise<boolean> {
  if (!process.env.DATABASE_URL || process.env.CONDUIT_TEST_MEMORY === "true") return true;
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: postgresSsl(),
    max: 1,
    connectionTimeoutMillis: 2000,
  });
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}
