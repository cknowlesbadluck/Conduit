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

// Performance Optimization: Single fast regex trigger test to skip expensive RegExp replace passes on safe strings.
// Matches characters or prefixes required by any credential pattern: =, @, sk-, lin_, rnd_, gh, sb, AKIA, eyJ, bearer, basic.
const SECRET_TRIGGER = /=|@|sk-|lin_|rnd_|gh|sb|AKIA|eyJ|bearer|basic/i;

export function redactString(text: string): string {
  if (!SECRET_TRIGGER.test(text)) return text;
  let out = text
    .replace(/([?&](?:token|key|secret|auth|code|password|access_token|api_key|apikey)=)[^&\s]*/gi, `$1${REDACTED}`)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`)
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:)[^@\s]+@/gi, `$1${REDACTED}@`);
  for (const pattern of PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

export function redactRecord<T extends Record<string, unknown>>(data: T, depth = 0): T {
  const out: Record<string, unknown> = {};
  // Performance Optimization: Single-pass Object.keys loop avoids intermediate tuple and array slice allocations
  // (previously Object.entries(data).slice(0, 500)).
  const keys = Object.keys(data);
  const limit = Math.min(keys.length, 500);
  for (let i = 0; i < limit; i++) {
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
