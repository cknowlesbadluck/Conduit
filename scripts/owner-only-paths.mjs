// Single source of truth for Conduit paths that only the owner may merge.
// Used by scripts/merge-train.mjs (and by the merge-readiness checker when it lands) so the
// two gates cannot drift: before this module they disagreed (merge-train missed migrations,
// secrets, .env, DB TLS, proxy trust, render.yaml and workflows; the readiness draft missed
// bridge, external-policy and receipt).
// Fail closed: tests that touch these surfaces are owner-only too, since weakening an
// assertion is a way to weaken the guard.
export const OWNER_ONLY_PATHS = Object.freeze([
  /(^|\/)auth/i, // token verification, scopes, auth tests
  /^src\/(index|app-factory)\.ts$/, // production boot and /mcp wiring
  /grant/i, /capabilit/i, /tool-gates/i, // capability grants and enforcement
  /bridge/i, /external-policy/i, /receipt/i, // MCP bridge, outbound policy, receipts
  /migrat/i, // schema migrations
  /secret/i, /(^|\/)\.env/i, // secrets and env files
  /tls/i, /^src\/(store|db-ready|binding-subjects|capability-store)\.ts$/, // DB TLS / pool SSL config
  /proxy/i, /trust/i, // proxy trust / client IP keying
  /(^|\/)render\.yaml$/i, /^\.github\/workflows\//i, // deploy and CI config
]);

/** True when a repo-relative path is owner-only. Non-strings and empty strings fail closed. */
export function isOwnerOnlyPath(path) {
  if (typeof path !== "string" || path.length === 0) return true;
  return OWNER_ONLY_PATHS.some((re) => re.test(path));
}

/** Paths in `files` that are owner-only (accepts strings or { filename } / { path } objects). */
export function ownerOnlyPaths(files) {
  return (files ?? []).map((f) => (typeof f === "string" ? f : f?.filename ?? f?.path)).filter((p) => isOwnerOnlyPath(p));
}
