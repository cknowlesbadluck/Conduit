/**
 * Privacy floor for anything Conduit persists (activity rows) or writes to logs/error results.
 * Upstream error text and caller-supplied fields are untrusted: they can echo a credential.
 * Mirrors Resonance src/nexus/redact.ts. Conservative and bounded so it can never hang.
 */
export const REDACTED = "[REDACTED]";

const SENSITIVE_KEY = /^(authorization|cookie|password|passwd|secret|client_secret|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|token|private[-_]?key)$/i;

const PATTERNS: RegExp[] = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\blin_(?:api|oauth)_[A-Za-z0-9]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bsb[ps]_[A-Za-z0-9]{20,}\b/g,
  /\brnd_[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
];

// Performance Optimization: Fast-path trigger regex checks whether text contains any query string delimiters,
// authorization headers, URL schemes, or credential prefixes before executing 11 regex replacements.
const MAYBE_SECRET = /[?&]|bearer|basic|:\/\/[^@]*@|gh[posru]_|github_pat_|lin_|sk-|sb[ps]_|rnd_|AKIA|eyJ/i;

export function redactString(text: string): string {
  if (!MAYBE_SECRET.test(text)) return text;
  let out = text
    .replace(/([?&](?:token|key|secret|auth|code|password|access_token|api_key|apikey)=)[^&\s]*/gi, `$1${REDACTED}`)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`)
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:)[^@\s]+@/gi, `$1${REDACTED}@`);
  for (const pattern of PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

export function redactRecord<T extends Record<string, unknown>>(data: T, depth = 0): T {
  const out: Record<string, unknown> = {};
  // Performance Optimization: Object.keys iteration avoids allocating tuple arrays from Object.entries(data).
  const keys = Object.keys(data);
  const len = Math.min(keys.length, 500);
  for (let i = 0; i < len; i++) {
    const key = keys[i];
    const value = data[key];
    if (SENSITIVE_KEY.test(key)) out[key] = REDACTED;
    else if (typeof value === "string") out[key] = redactString(value);
    else if (value && typeof value === "object" && !Array.isArray(value)) out[key] = depth >= 6 ? REDACTED : redactRecord(value as Record<string, unknown>, depth + 1);
    else if (Array.isArray(value)) out[key] = depth >= 6 ? REDACTED : value.slice(0, 500).map((item) => typeof item === "string" ? redactString(item) : item && typeof item === "object" ? redactRecord(item as Record<string, unknown>, depth + 1) : item);
    else out[key] = value;
  }
  return out as T;
}
