export type DevelopmentContext = {
  purpose: string;
  status: "active";
  primaryProject: {
    name: string;
    repository: string;
    role: string;
  };
  conduitBoundary: string;
  currentObjectives: string[];
  constraints: string[];
};

export function getDevelopmentContext(): DevelopmentContext {
  return {
    purpose: "Help coordinate the agents, tools, connectors, skills, and development resources used to build Resonance.",
    status: "active",
    primaryProject: {
      name: "Resonance",
      repository: "cknowlesbadluck/Resonance",
      role: "Primary product being developed; Conduit is a separate development bridge and is not part of the Resonance application.",
    },
    conduitBoundary: "Conduit is a separate development bridge whose current purpose is to support Resonance development. Do not treat Conduit as a Resonance runtime component, feature, or replacement for Resonance's native iOS app or administrative web layer.",
    currentObjectives: [
      "Provide shared development context to participating agents.",
      "Coordinate work through registered agents and tasks.",
      "Expose shared development resources and MCP endpoints.",
      "Maintain an auditable activity trail for coordinated work.",
      "Keep development coordination independent from the Resonance codebase.",
    ],
    constraints: [
      "Prefer free or already-connected development resources.",
      "Do not require a Mac or local developer machine for coordination workflows.",
      "Do not silently modify Resonance from Conduit; agents must operate through their authorized development tools.",
    ],
  };
}
