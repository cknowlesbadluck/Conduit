import { assertCapability, capabilitiesRequired, type CapabilityProvider } from "./capabilities.js";
import { getCapabilityGrantsForAgent } from "./capability-store.js";
import { EXTERNAL_RATE_LIMITER } from "./rate-limit.js";

export async function enforceExternalCapability(input: {
  agentId?: string;
  provider: CapabilityProvider;
  method: string;
  path: string;
  projectId?: string;
}) {
  if (!capabilitiesRequired()) return;
  if (!input.agentId) throw new Error("agent_identity_required_for_external_call");
  const rate = EXTERNAL_RATE_LIMITER.check(`external:${input.agentId}:${input.provider}`);
  if (!rate.allowed) throw new Error("external_rate_limited");
  const grants = await getCapabilityGrantsForAgent(input.agentId, input.projectId);
  assertCapability(grants, { agentId: input.agentId, provider: input.provider, method: input.method, path: input.path, projectId: input.projectId });
}
