export type CapabilityProvider = "github" | "render" | "supabase" | "mcp_bridge";

export type CapabilityGrant = {
  id: string;
  projectId?: string;
  agentId: string;
  provider: CapabilityProvider;
  method: string;
  pathPattern: string;
  expiresAt?: string;
  createdBy: string;
  createdAt: string;
  revokedAt?: string;
};

export type CapabilityRequest = {
  agentId: string;
  provider: CapabilityProvider;
  method: string;
  path: string;
  projectId?: string;
};

const normalizeMethod = (method: string) => method.toUpperCase();

function normalizePath(path: string) {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    const url = new URL(path);
    return `${url.origin}${url.pathname}${url.search}`;
  }
  return path.startsWith("/") ? path : `/${path}`;
}

/**
 * Glob path matching for capability grants (deny-by-default).
 *
 * Supported forms:
 * - Exact path
 * - Whole-segment wildcard: one path segment equal to "*"
 * - Recursive prefix ending with "/**"
 * - Trailing single-star prefix ending with "*" (not "/*"): path equals or starts with the literal prefix
 *
 * Regex-style patterns (leading "^", trailing ".*") never match.
 */
function matchPattern(pattern: string, value: string): boolean {
  const normalizedPattern = normalizePath(pattern);
  const normalizedValue = normalizePath(value);

  // Recursive directory wildcard: ends with /**
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3).replace(/\/$/, "");
    return normalizedValue === prefix || normalizedValue.startsWith(`${prefix}/`);
  }

  // Trailing single-star prefix: ends with * but not /*
  // Example grant: /v1/services/srv-xxx*  matches that service id and its subpaths
  if (normalizedPattern.endsWith("*") && !normalizedPattern.endsWith("/*")) {
    const prefix = normalizedPattern.slice(0, -1);
    return normalizedValue === prefix || normalizedValue.startsWith(prefix);
  }

  // Segment-wise exact / single-segment *
  const patternParts = normalizedPattern.split("/").filter(Boolean);
  const valueParts = normalizedValue.split("/").filter(Boolean);
  if (patternParts.length !== valueParts.length) return false;
  return patternParts.every((part, index) => part === "*" || part === valueParts[index]);
}

export function matchesCapability(grant: CapabilityGrant, request: CapabilityRequest): boolean {
  if (grant.revokedAt) return false;
  if (grant.agentId !== request.agentId) return false;
  if (grant.provider !== request.provider) return false;
  if (grant.projectId && grant.projectId !== request.projectId) return false;
  if (normalizeMethod(grant.method) !== "*" && normalizeMethod(grant.method) !== normalizeMethod(request.method)) return false;
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.now()) return false;
  return matchPattern(grant.pathPattern, request.path);
}

export function assertCapability(grants: CapabilityGrant[], request: CapabilityRequest): void {
  if (!grants.some((grant) => matchesCapability(grant, request))) {
    throw new Error("capability_denied");
  }
}

export function capabilitiesRequired(): boolean {
  if (process.env.CONDUIT_CAPABILITIES_REQUIRED !== undefined) return process.env.CONDUIT_CAPABILITIES_REQUIRED === "true";
  return process.env.NODE_ENV === "production";
}
