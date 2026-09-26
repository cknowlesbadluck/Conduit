export type Page<T> = { items: T[]; nextCursor?: string };

export type CursorCollection = "agents" | "projects" | "resources" | "tasks" | "contacts" | "tools" | "activity";
export type CursorOrder = { field: "createdAt" | "at"; direction: "desc"; tieBreaker: "id" };
export type CursorPayload = {
  version: 1;
  collection: CursorCollection;
  projectId: string | null;
  filters: Record<string, string>;
  order: CursorOrder;
  sort: { time: string; id: string };
};

const orders: Record<CursorCollection, CursorOrder> = {
  agents: { field: "createdAt", direction: "desc", tieBreaker: "id" },
  projects: { field: "createdAt", direction: "desc", tieBreaker: "id" },
  resources: { field: "createdAt", direction: "desc", tieBreaker: "id" },
  tasks: { field: "createdAt", direction: "desc", tieBreaker: "id" },
  contacts: { field: "createdAt", direction: "desc", tieBreaker: "id" },
  tools: { field: "createdAt", direction: "desc", tieBreaker: "id" },
  activity: { field: "at", direction: "desc", tieBreaker: "id" },
};

const sameRecord = (a: Record<string, string>, b: Record<string, string>) => {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  return ak.length === bk.length && ak.every((key, index) => key === bk[index] && a[key] === b[key]);
};

/** Opaque, versioned keyset cursor codec. Decode validates that a cursor belongs to this exact query. */
export const cursorCodec = {
  encode(payload: CursorPayload): string {
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  },
  decode(cursor: string, expected: { collection: CursorCollection; projectId?: string; filters?: Record<string, string> }): CursorPayload {
    try {
      const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<CursorPayload>;
      const order = orders[expected.collection];
      const filters = expected.filters ?? {};
      if (value.version !== 1 || value.collection !== expected.collection || value.projectId !== (expected.projectId ?? null)
        || !value.filters || !sameRecord(value.filters, filters) || !value.order
        || value.order.field !== order.field || value.order.direction !== "desc" || value.order.tieBreaker !== "id"
        || !value.sort || typeof value.sort.time !== "string" || !Number.isFinite(Date.parse(value.sort.time))
        || typeof value.sort.id !== "string" || !value.sort.id) throw new Error("invalid_cursor");
      return value as CursorPayload;
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_cursor") throw error;
      throw new Error("invalid_cursor");
    }
  },
};

export function pageLimit(limit = 50, max = 200) { return Math.max(1, Math.min(limit, max, 200)); }
export function cursorOrder(collection: CursorCollection) { return orders[collection]; }
