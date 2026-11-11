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
  if (normalizeMethod(grant.method) !== "*" && normalizeMethod(grant.method) !== normalizeMethod(request.method)) return false;
  if (grant.expiresAt !== undefined && grant.expiresAt !== null) {
    // Fail closed: an unparseable expiry must not behave as "never expires".
    const expiry = Date.parse(grant.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) return false;
  }
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

/**
 * Hosted production is not only NODE_ENV. Render sets RENDER; an explicit
 * CONDUIT_PRODUCTION=true covers other hosts. An explicit
 * CONDUIT_CAPABILITIES_REQUIRED=true|false always wins, including "false".
 */
export function isHostedProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "production") return true;
  if (env.CONDUIT_PRODUCTION === "true") return true;
  if (typeof env.RENDER === "string" && env.RENDER.length > 0) return true;
  return false;
}

export function capabilitiesRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CONDUIT_CAPABILITIES_REQUIRED !== undefined && env.CONDUIT_CAPABILITIES_REQUIRED !== "") {
    return env.CONDUIT_CAPABILITIES_REQUIRED === "true";
  }
  return isHostedProduction(env);
}

/** Test-memory mode must never boot a hosted production process. */
export function assertNotTestMemoryInProduction(env: NodeJS.ProcessEnv = process.env): void {
  if (isHostedProduction(env) && env.CONDUIT_TEST_MEMORY === "true") {
    throw new Error("CONDUIT_TEST_MEMORY is refused on a production runtime");
  }
}
