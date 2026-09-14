import pg from "pg";
import { getProject, listAgents } from "./store.js";
import type { CapabilityGrant, CapabilityProvider } from "./capabilities.js";

const { Pool } = pg;
const useDatabase = Boolean(process.env.DATABASE_URL) && process.env.CONDUIT_TEST_MEMORY !== "true";
const sslRejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true";
const sslOption = process.env.DATABASE_SSL === "false"
  ? false
  : { rejectUnauthorized: sslRejectUnauthorized };

const pool = useDatabase
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslOption,
      max: 3,
    })
  : null;
