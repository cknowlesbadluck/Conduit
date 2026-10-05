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

// Performance Optimization: Fast-path absolute paths starting with "/" (charCodeAt(0) === 47)
// to avoid unnecessary .startsWith("http://") and .startsWith("https://") scans.
function normalizePath(path: string) {
  if (path.length > 0 && path.charCodeAt(0) === 47 /* '/' */) return path;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    const url = new URL(path);
    return `${url.origin}${url.pathname}${url.search}`;
  }
  return `/${path}`;
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

  // Performance Optimization: Direct O(1) equality check for exact path matches
  // avoids regex/suffix scans and array allocations from .split("/").filter(Boolean).
  if (normalizedPattern === normalizedValue) return true;

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
  // Performance Optimization: Normalize both grant.method and request.method once into local variables
  // to avoid redundant normalizeMethod() calls inside the method comparison logic.
  const grantMethodUpper = normalizeMethod(grant.method);
  const reqMethodUpper = normalizeMethod(request.method);
  if (grantMethodUpper !== "*" && grantMethodUpper !== reqMethodUpper) return false;
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.now()) return false;
  return matchPattern(grant.pathPattern, request.path);
}

export function assertCapability(grants: CapabilityGrant[], request: CapabilityRequest): void {
  if (!grants.some((grant) => matchesCapability(grant, request))) {
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
