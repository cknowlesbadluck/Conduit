const messages: Record<string, string> = {
  agent_identity_already_bound: "Agent identity is already bound to another logical agent",
  agent_identity_conflict: "Agent identity conflicts with an existing registration",
  agent_identity_not_bound: "Agent identity is not bound to the authenticated actor. Register this agent first.",
  agent_identity_not_bound_or_impersonation: "Agent identity is not bound to the authenticated actor, or the requested agent does not match the binding",
  agent_unregistered: "Agent is not registered",
  creator_not_registered: "Task creator is not registered",
  handoff_rejected: "Task handoff was rejected because the caller does not own the task or the target agent is unregistered",
  integration_call_failed: "Integration call failed",
  mcp_bridge_call_failed: "MCP bridge call failed",
  project_creator_not_registered: "Project creator is not registered",
  project_not_found: "Project not found",
  project_not_found_or_agent_unregistered: "Project was not found or agent is not registered",
  task_not_claimed_by_agent: "Task is not claimed by the authenticated agent",
  task_not_found: "Task not found",
  task_not_owned_or_not_claimed: "Task is not owned by or claimed by the authenticated agent",
  task_not_owned_or_not_releasable: "Task is not owned by the authenticated agent or cannot be released",
  task_unavailable_or_agent_unregistered: "Task is unavailable or agent is not registered",
};

export function errorEnvelope(code: string, details?: unknown) {
  const error = { code, message: messages[code] ?? code.replaceAll("_", " ") };
  return details === undefined ? { error } : { error: { ...error, details } };
}

export function errorResult(code: string, details?: unknown) {
  const envelope = errorEnvelope(code, details);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
    structuredContent: envelope,
    isError: true as const,
  };
}
