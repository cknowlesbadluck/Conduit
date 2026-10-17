import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Guard: every server-side outbound fetch carries an AbortSignal (timeout), and the raw https bridge
 * transport keeps both its idle timeout and its total deadline. Browser code in ui.ts (same-origin
 * /status poll) is the only exemption.
 */
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const EXEMPT = new Set(["ui.ts"]);

function sources(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !EXEMPT.has(f)).map((f) => path.join(dir, f));
}

test("every server-side fetch() passes a signal", () => {
  const offenders: string[] = [];
  for (const file of sources(path.join(ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\bfetch\(/g)) {
      const window = text.slice(match.index, match.index + 600);
      // The init object may be a variable built just above the call (integrations.ts), so look back too.
      const before = text.slice(Math.max(0, match.index - 1500), match.index);
      if (!/signal\s*:/.test(window) && !/signal\s*:\s*AbortSignal\.timeout/.test(before)) offenders.push(`${path.basename(file)}@${match.index}`);
    }
  }
  assert.deepEqual(offenders, [], `fetch without a timeout signal: ${offenders.join(", ")}`);
});

test("the pinned https bridge transport keeps an idle timeout and a total deadline", () => {
  const text = readFileSync(path.join(ROOT, "src", "mcp-bridge.ts"), "utf8");
  assert.match(text, /timeout: REQUEST_TIMEOUT_MS/);
  assert.match(text, /totalDeadline = setTimeout\(/);
  assert.match(text, /withDeadline\(bridgeTransport\(/);
  assert.match(text, /withDeadline\(validateEndpoint\(/, "DNS resolution is inside the deadline");
  assert.match(text, /signal\?\.addEventListener\("abort", onAbort/, "transport destroys the socket on the caller deadline");
});
