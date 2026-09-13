import { assertCapability, capabilitiesRequired, type CapabilityProvider } from "./capabilities.js";
import { getCapabilityGrantsForAgent } from "./capability-store.js";

export async function enforceExternalCapability(input: {
  agentId?: string;
  provider: CapabilityProvider;
  method: string;
  path: string;
  projectId?: string;
}) {
  if (!capabilitiesRequired()) return;
  if (!input.agentId) throw new Error("agent_identity_required_for_external_call");
  const grants = await getCapabilityGrantsForAgent(input.agentId, input.projectId);
  assertCapability(grants, { agentId: input.agentId, provider: input.provider, method: input.method, path: input.path, projectId: input.projectId });
}
