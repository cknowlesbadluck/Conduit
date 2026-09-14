import type { AuthInfo } from "@modelcontextprotocol/server";
import { listTasks, getBoundAgentId, getProject, type Task } from "../store.js";
import { listCapabilityGrants } from "../capability-store.js";
import type { CapabilityGrant } from "../capabilities.js";
import { decideGrantListVisibility } from "../grant-tools.js";

export type StationSnapshot = {
  generatedAt: string;
  projectId?: string;
  subject?: string;
  boundAgentId?: string;
  tasks: Task[];
  grants: CapabilityGrant[];
  grantsNote?: string;
};

function actorSubject(authInfo: AuthInfo | undefined): string | undefined {
  if (!authInfo) return undefined;
  return typeof authInfo.extra?.sub === "string" && authInfo.extra.sub.length > 0
    ? authInfo.extra.sub
    : authInfo.clientId;
}

function grantAdmins(): Set<string> {
  return new Set(
    (process.env.CONDUIT_GRANT_ADMIN_SUBJECTS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

/**
 * Read-only snapshot for the station UI.
 * Tasks: optional projectId filter (workforce monitor).
 * Grants: same visibility rules as grants_list (decideGrantListVisibility).
 */
export async function loadStationSnapshot(
  authInfo: AuthInfo | undefined,
  projectId?: string,
): Promise<StationSnapshot> {
  const subject = actorSubject(authInfo);
  const boundAgentId = subject ? (await getBoundAgentId(subject)) ?? undefined : undefined;
  const callerAgentId = boundAgentId ?? subject;
  const isAdmin = Boolean(subject && grantAdmins().has(subject));
  let governsRequestedProject = false;
  if (subject && projectId) {
    if (isAdmin) governsRequestedProject = true;
    else {
      const project = await getProject(projectId);
      governsRequestedProject = project?.createdBy === callerAgentId;
    }
  }

  const tasks = await listTasks(projectId ? { projectId } : {});

  const decision = decideGrantListVisibility({
    requestedProjectId: projectId,
    includeRevoked: false,
    callerAgentId,
    isAdmin,
    governsRequestedProject,
  });

  let grants: CapabilityGrant[] = [];
  let grantsNote: string | undefined;
  if (!decision.ok) {
    grantsNote =
      decision.error === "grant_scope_required"
        ? "Bind an agent or pass ?projectId= to list grants."
        : decision.error === "agent_identity_not_bound"
          ? "Agent identity is not bound; grants hidden."
          : `Grants unavailable: ${decision.error}`;
  } else {
    grants = await listCapabilityGrants({
      agentId: decision.agentId,
      projectId: decision.projectId,
      includeRevoked: decision.includeRevoked,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    projectId,
    subject,
    boundAgentId,
    tasks,
    grants,
    grantsNote,
  };
}
