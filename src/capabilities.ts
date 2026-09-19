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

function matchPattern(pattern: string, value: string, normalizedValue?: string): boolean {
  const normalizedPattern = normalizePath(pattern);
  // Performance Optimization: Use pre-normalized request path if supplied to avoid redundant
  // expensive URL parsing (new URL()) inside grant matching loops.
  const targetValue = normalizedValue ?? normalizePath(value);
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3).replace(/\/$/, "");
    return targetValue === prefix || targetValue.startsWith(`${prefix}/`);
  }
  const patternParts = normalizedPattern.split("/").filter(Boolean);
  const valueParts = targetValue.split("/").filter(Boolean);
  if (patternParts.length !== valueParts.length) return false;
  return patternParts.every((part, index) => part === "*" || part === valueParts[index]);
}

export function matchesCapability(grant: CapabilityGrant, request: CapabilityRequest, normalizedRequestPath?: string): boolean {
  if (grant.revokedAt) return false;
  if (grant.agentId !== request.agentId) return false;
  if (grant.provider !== request.provider) return false;
  if (grant.projectId && grant.projectId !== request.projectId) return false;
  if (normalizeMethod(grant.method) !== "*" && normalizeMethod(grant.method) !== normalizeMethod(request.method)) return false;
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.now()) return false;
  return matchPattern(grant.pathPattern, request.path, normalizedRequestPath);
}

export function assertCapability(grants: CapabilityGrant[], request: CapabilityRequest): void {
  // Performance Optimization: Normalize request.path once upfront before iterating over capability grants.
  const normalizedRequestPath = normalizePath(request.path);
  if (!grants.some((grant) => matchesCapability(grant, request, normalizedRequestPath))) {
    throw new Error("capability_denied");
  }
}

export function capabilitiesRequired(): boolean {
  if (process.env.CONDUIT_CAPABILITIES_REQUIRED !== undefined) return process.env.CONDUIT_CAPABILITIES_REQUIRED === "true";
  return process.env.NODE_ENV === "production";
}
