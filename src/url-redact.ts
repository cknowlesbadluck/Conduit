/** Query parameter names that look like credentials and must never be echoed. */
const SECRET_PARAM = /(token|secret|key|password|passwd|pwd|auth|signature|sig|credential|session|code)/i;

/**
 * Return a URL safe to echo (diagnostics, logs, OAuth metadata): userinfo is removed
 * and token-like query parameters are dropped. Unparseable input returns "[invalid-url]"
 * so the raw (possibly secret-bearing) string is never reflected.
 */
export function redactUrl(value: string | URL | undefined | null): string {
  if (value === undefined || value === null || value === "") return "";
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    return "[invalid-url]";
  }
  url.username = "";
  url.password = "";
  for (const name of [...url.searchParams.keys()]) {
    if (SECRET_PARAM.test(name)) url.searchParams.delete(name);
  }
  return url.toString();
}
