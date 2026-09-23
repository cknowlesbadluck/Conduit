import pg from "pg";

const { Pool } = pg;

export type TaskStatus = "open" | "claimed" | "blocked" | "completed";
