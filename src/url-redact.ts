/**
 * Credential-like query parameter name tokens. A parameter is dropped only when one of its
 * name tokens (split on separators and camelCase) matches exactly, so ordinary names that
 * merely contain a substring (`zipcode`, `author`, `monkey`) are preserved. This matters
 * because the redacted MCP_RESOURCE_URL is also the JWT audience.
 */
const SECRET_TOKENS = new Set([
  "token", "secret", "key", "apikey", "password", "passwd", "pwd", "auth", "authorization",
  "signature", "sig", "credential", "credentials", "session", "sessionid", "code", "jwt",
  "accesstoken", "refreshtoken", "idtoken", "clientsecret",
]);

export function isSecretParamName(name: string): boolean {
  const tokens = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.some((t) => SECRET_TOKENS.has(t))) return true;
  return SECRET_TOKENS.has(tokens.join(""));
}

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
  url.hash = "";
  if (url.search) {
    // Rebuild from the raw pairs so kept params keep their original encoding (this URL can be the JWT audience).
    const kept = url.search.slice(1).split("&").filter((pair) => {
      if (pair === "") return false;
      const rawName = pair.split("=", 1)[0];
      let name = rawName;
      try { name = decodeURIComponent(rawName.replace(/\+/g, " ")); } catch { return false; }
      return !isSecretParamName(name);
    });
    url.search = kept.length ? `?${kept.join("&")}` : "";
  }
  return url.toString();
}
