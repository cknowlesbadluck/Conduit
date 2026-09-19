import test from "node:test";
import assert from "node:assert/strict";
import { init, registerAgent, getBoundAgentId, createProject, listProjects, registerResource, listResources, createTask, listTasks, addContact, listContacts, registerTool, listTools, listActivity, getCoordinationContext, claimTask, handoff, archiveProject, archiveResource, getProject } from "./store.js";

await init();
