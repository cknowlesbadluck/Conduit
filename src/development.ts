export type DevelopmentContext = {
  purpose: string;
  status: "active";
  scope: string;
  capabilities: string[];
  constraints: string[];
};

export function getDevelopmentContext(): DevelopmentContext {
  return {
    purpose: "Coordinate AI agents, tools, connectors, skills, MCP servers, development resources, and shared context so they can work together on software projects.",
    status: "active",
    scope: "Project-agnostic development coordination. Any project may use Conduit; no individual project defines Conduit's identity or architecture.",
    capabilities: [
      "Provide shared development context to participating agents.",
      "Register and discover agents.",
      "Create, claim, complete, and hand off work with ownership controls.",
      "Register and discover shared contacts, resources, tools, and MCP endpoints.",
      "Maintain an auditable activity trail for coordinated work.",
      "Expose a single authenticated MCP endpoint for participating agents.",
    ],
    constraints: [
      "Prefer free or already-connected development resources.",
      "Do not require a Mac or local developer machine for coordination workflows.",
      "Conduit coordinates work; it does not become part of the application being developed.",
      "Project-specific context belongs in project/resource records, not in Conduit's core identity.",
    ],
  };
}
