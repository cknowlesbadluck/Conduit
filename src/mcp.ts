function sanitizeForLog(text: string): string {
  return text.replace(/([?&](?:token|key|secret|auth|code|password|access_token|api_key|apikey)=)[^&]*/gi, "$1[REDACTED]");
}
import { McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  registerAgent, getBoundAgentId, createProject, registerResource,
  getProject, createTask, getTask, claimTask, blockTask, releaseTask, completeTask, handoff, addContact, registerTool,
} from "./store.js";
import { getDevelopmentContext } from "./development.js";
import { callIntegration, integrationMethods, integrationProviders, listIntegrations } from "./integrations.js";
import { callMcpBridge } from "./mcp-bridge.js";
import { requireScope, type ConduitAuthConfig } from "./auth.js";
import { VERSION, SERVICE_NAME } from "./version.js";
import { errorResult } from "./errors.js";
import { registerGrantTools } from "./grant-tools.js";
import { registerPaginationTools } from "./pagination-tools.js";
import { enforceExternalCapability } from "./external-policy.js";

export type ToolExtra = { http?: { authInfo?: AuthInfo } };

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  structuredContent: value as Record<string, unknown>,
});
const auth = (extra: ToolExtra, scope: string) => requireScope(extra.http?.authInfo, scope);

export function oauthSubject(extra: ToolExtra) {
  const info = extra.http?.authInfo;
  if (!info) return undefined;
  return typeof info.extra?.sub === "string" && info.extra.sub.length > 0 ? info.extra.sub : undefined;
}

export function actorSubject(extra: ToolExtra) {
  const info = extra.http?.authInfo;
  if (!info) return undefined;
  const sub = oauthSubject(extra);
  const clientId = typeof info.clientId === "string" && info.clientId.length > 0 ? info.clientId : undefined;
  // client_id is the OAuth app, shared by every user of that host. Never use it alone.
  if (clientId && sub && clientId !== sub) return `${clientId}::${sub}`;
  return sub ?? clientId;
}

export async function lookupBoundAgent(extra: ToolExtra) {
  const subject = actorSubject(extra);
  if (!subject) return undefined;
  const primary = await getBoundAgentId(subject);
  if (primary) return primary;
  const sub = oauthSubject(extra);
  if (sub && sub !== subject) return getBoundAgentId(sub);
  return undefined;
}

const boundAgent = async (extra: ToolExtra) => lookupBoundAgent(extra);

export async function resolveBoundAgent(extra: ToolExtra, requested?: string) {
  const subject = actorSubject(extra);
  if (!subject) return requested ?? null;
  const bound = await lookupBoundAgent(extra);
  if (!bound || (requested && requested !== bound)) return null;
  return bound;
}
