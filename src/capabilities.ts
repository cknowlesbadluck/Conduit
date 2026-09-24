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
function matchPattern(pattern: string, normalizedValue: string): boolean {
  const normalizedPattern = normalizePath(pattern);

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

type NormalizedRequest = {
  method: string;
  path: string;
  now: number;
};

export function matchesCapability(
  grant: CapabilityGrant,
  request: CapabilityRequest,
  normalizedReq?: NormalizedRequest,
): boolean {
  if (grant.revokedAt) return false;
  if (grant.agentId !== request.agentId) return false;
  if (grant.provider !== request.provider) return false;
  if (grant.projectId && grant.projectId !== request.projectId) return false;

  const reqMethod = normalizedReq?.method ?? normalizeMethod(request.method);
  const grantMethod = normalizeMethod(grant.method);
  if (grantMethod !== "*" && grantMethod !== reqMethod) return false;

  const now = normalizedReq?.now ?? Date.now();
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= now) return false;

  const reqPath = normalizedReq?.path ?? normalizePath(request.path);
  return matchPattern(grant.pathPattern, reqPath);
}

export function assertCapability(grants: CapabilityGrant[], request: CapabilityRequest): void {
  // Performance Optimization: Pre-normalize request method, path, and timestamp once
  // to avoid redundant string normalization, URL parsing, and Date.now() calls per grant.
  const normalizedReq: NormalizedRequest = {
    method: normalizeMethod(request.method),
    path: normalizePath(request.path),
    now: Date.now(),
  };

  if (!grants.some((grant) => matchesCapability(grant, request, normalizedReq))) {
    const project = request.projectId ? ` projectId=${request.projectId}` : "";
    throw new Error(
      `capability_denied agent=${request.agentId} provider=${request.provider} method=${request.method} path=${request.path}${project}. Grant a matching pathPattern: exact path, one-segment *, recursive prefix /**, or trailing single-star prefix.`,
    );
  }
}

export function capabilitiesRequired(): boolean {
  if (process.env.CONDUIT_CAPABILITIES_REQUIRED !== undefined) return process.env.CONDUIT_CAPABILITIES_REQUIRED === "true";
  return process.env.NODE_ENV === "production";
}
