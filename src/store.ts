import pg from "pg";

const { Pool } = pg;

export type TaskStatus = "open" | "claimed" | "blocked" | "completed";
export type Agent = { id: string; name: string; description?: string; createdAt: string };
export type Project = { id: string; name: string; description: string; createdBy: string; createdAt: string; updatedAt: string; archivedAt?: string };
export type Resource = { id: string; projectId?: string; name: string; description: string; kind: string; endpoint?: string; createdBy: string; createdAt: string; updatedAt: string; archivedAt?: string };
