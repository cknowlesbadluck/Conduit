function sanitizeForLog(text: string): string {
  return text.replace(/([?&](?:token|key|secret|auth|code|password|access_token|api_key|apikey)=)[^&]*/gi, "$1[REDACTED]");
}
import { McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  registerAgent, getBoundAgentId, createProject, registerResource,
  getProject, archiveProject, archiveResource, createTask, getTask, claimTask, blockTask, releaseTask, completeTask, handoff, addContact, registerTool,
} from "./store.js";
import { getDevelopmentContext } from "./development.js";
import { callIntegration, integrationMethods, integrationProviders, listIntegrations } from "./integrations.js";
import { callMcpBridge } from "./mcp-bridge.js";
import { requireScope, type ConduitAuthConfig } from "./auth.js";
import { VERSION, SERVICE_NAME } from "./version.js";
import { errorResult } from "./errors.js";
import { isGrantAdmin, registerGrantTools } from "./grant-tools.js";
import { registerPaginationTools } from "./pagination-tools.js";
import { enforceExternalCapability } from "./external-policy.js";
import { actorBindingKey, actorBindingLookupKeys } from "./actor-binding.js";
