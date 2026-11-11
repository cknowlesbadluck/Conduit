/**
 * Exact normalized credential parameter names. Do not match generic tokens inside
 * compound application fields: this URL can become the exact OAuth JWT audience.
 */
const SECRET_NAMES = new Set([
  "token", "secret", "key", "apikey", "apisecret", "apitoken",
  "password", "passwd", "pwd", "auth", "authorization", "authtoken",
  "signature", "sig", "xamzsignature", "xamzsecuritytoken", "credential", "credentials",
  "session", "sessionid", "code", "jwt", "jwttoken",
  "accesstoken", "refreshtoken", "idtoken", "clientsecret",
]);

export function isSecretParamName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SECRET_NAMES.has(normalized);
}

/**
 * Return a URL safe to echo (diagnostics, logs, OAuth metadata): userinfo is removed
 * and known credential query parameters are dropped. Unparseable input returns
 * "[invalid-url]" so the raw (possibly secret-bearing) string is never reflected.
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
    // Preserve every retained raw query component byte-for-byte. Empty components
    // are meaningful separators and must not silently change an OAuth audience.
    const kept = url.search.slice(1).split("&").filter((pair) => {
      if (pair === "") return true;
      const rawName = pair.split("=", 1)[0];
      let name: string;
      try {
        name = decodeURIComponent(rawName.replace(/\+/g, " "));
      } catch {
        // Malformed parameter names are not safe to reflect.
        return false;
      }
      return !isSecretParamName(name);
    });
    url.search = kept.length ? `?${kept.join("&")}` : "";
  }
  return url.toString();
}
