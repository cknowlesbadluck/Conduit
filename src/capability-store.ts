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
    })
  : null;

const memory = new Map<string, CapabilityGrant>();
let initialized = false;

const id = () => `grant_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

async function logActivity(type: string, data: Record<string, unknown>) {
  const eventId = `evt_${crypto.randomUUID()}`;
  const at = now();
  if (pool) {
    await pool.query("INSERT INTO activity(id, type, at, data, project_id) VALUES($1, $2, $3, $4, $5)", [
      eventId,
      type,
      at,
      JSON.stringify(data),
      data.projectId ?? null,
    ]);
  }
}

export async function initCapabilityStore() {
  if (initialized) return;
  initialized = true;
}

async function projectExists(projectId: string) {
  return Boolean(await getProject(projectId));
}

export async function createCapabilityGrant(input: {
  projectId?: string;
  agentId: string;
  provider: CapabilityProvider;
  method: string;
  pathPattern: string;
  expiresAt?: string;
  createdBy: string;
}): Promise<CapabilityGrant> {
  await initCapabilityStore();
  if (!(await agentExists(input.agentId)) || !(await agentExists(input.createdBy))) {
    throw new Error("agent_unregistered");
  }
  if (input.projectId && !(await projectExists(input.projectId))) {
    throw new Error("project_not_found");
  }
  if (input.expiresAt && !Number.isFinite(Date.parse(input.expiresAt))) {
    throw new Error("invalid_expiry");
  }

  const grant: CapabilityGrant = {
    id: id(),
    ...input,
    method: input.method.toUpperCase(),
    createdAt: now(),
  };

  if (pool) {
    await pool.query(
      "INSERT INTO capability_grants(id, project_id, agent_id, provider, method, path_pattern, expires_at, created_by) VALUES($1, $2, $3, $4, $5, $6, $7, $8)",
      [
        grant.id,
        grant.projectId ?? null,
        grant.agentId,
        grant.provider,
        grant.method,
        grant.pathPattern,
        grant.expiresAt ?? null,
        grant.createdBy,
      ],
    );
  } else {
    memory.set(grant.id, grant);
  }

  await logActivity("capability.grant", {
    grantId: grant.id,
    agentId: grant.agentId,
    provider: grant.provider,
    method: grant.method,
    pathPattern: grant.pathPattern,
    createdBy: grant.createdBy,
    ...(grant.projectId ? { projectId: grant.projectId } : {}),
  });

  return grant;
}

export async function revokeCapabilityGrant(idValue: string, actor: string): Promise<boolean> {
  await initCapabilityStore();
  let revokedGrant: CapabilityGrant | undefined;

  if (pool) {
    const result = await pool.query(
      "UPDATE capability_grants SET revoked_at=COALESCE(revoked_at, now()) WHERE id=$1 AND created_by=$2 RETURNING id, project_id AS \"projectId\", agent_id AS \"agentId\", provider",
      [idValue, actor],
    );
    if (result.rowCount !== 1) return false;
    revokedGrant = result.rows[0] as CapabilityGrant;
  } else {
    const grant = memory.get(idValue);
    if (!grant || grant.createdBy !== actor) return false;
    grant.revokedAt ??= now();
    revokedGrant = grant;
  }

  await logActivity("capability.revoke", {
    grantId: idValue,
    agentId: revokedGrant.agentId,
    revokedBy: actor,
    ...(revokedGrant.projectId ? { projectId: revokedGrant.projectId } : {}),
  });

  return true;
}

export async function listCapabilityGrants(
  filter: {
    agentId?: string;
    projectId?: string;
    provider?: CapabilityProvider;
    includeRevoked?: boolean;
  } = {},
): Promise<CapabilityGrant[]> {
  await initCapabilityStore();
  if (pool) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.agentId) {
      clauses.push(`agent_id=$${params.length + 1}`);
      params.push(filter.agentId);
    }
    if (filter.projectId) {
      const projectParam = params.length + 1;
      clauses.push(`(project_id IS NULL OR project_id=$${projectParam})`);
      params.push(filter.projectId);
    }
    if (filter.provider) {
      clauses.push(`provider=$${params.length + 1}`);
      params.push(filter.provider);
    }
    if (!filter.includeRevoked) {
      clauses.push("revoked_at IS NULL");
    }
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    const rows = (
      await pool.query(
        `SELECT id, project_id AS "projectId", agent_id AS "agentId", provider, method, path_pattern AS "pathPattern", expires_at AS "expiresAt", created_by AS "createdBy", created_at AS "createdAt", revoked_at AS "revokedAt" FROM capability_grants${where} ORDER BY created_at DESC`,
        params,
      )
    ).rows;

    return rows.map((row) => ({
      ...row,
      expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : undefined,
      createdAt: new Date(row.createdAt).toISOString(),
      revokedAt: row.revokedAt ? new Date(row.revokedAt).toISOString() : undefined,
    })) as CapabilityGrant[];
  }

  return [...memory.values()]
    .filter(
      (grant) =>
        (!filter.agentId || grant.agentId === filter.agentId) &&
        (!filter.projectId || !grant.projectId || grant.projectId === filter.projectId) &&
        (!filter.provider || grant.provider === filter.provider) &&
        (filter.includeRevoked || !grant.revokedAt),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getCapabilityGrantsForAgent(agentId: string, projectId?: string) {
  return listCapabilityGrants({ agentId, projectId });
}
