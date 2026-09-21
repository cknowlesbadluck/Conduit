import pg from "pg";
// Performance Optimization: Use store's exported agentExists to execute direct O(1) PK/Map check
// instead of fetching and sorting all agents via listAgents().
import { agentExists, getProject } from "./store.js";
import type { CapabilityGrant, CapabilityProvider } from "./capabilities.js";

const { Pool } = pg;
const useDatabase = Boolean(process.env.DATABASE_URL) && process.env.CONDUIT_TEST_MEMORY !== "true";
const pool = useDatabase
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
      max: 3,
      connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 8000),
      idleTimeoutMillis: 10_000,
    })
  : null;
