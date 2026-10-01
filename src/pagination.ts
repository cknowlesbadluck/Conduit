import { createHmac, timingSafeEqual } from "node:crypto";
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
  mac?: string;
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
function cursorSecret() {
  const secret = process.env.CONDUIT_CURSOR_SECRET;
  return secret && secret.length >= 16 ? secret : undefined;
}

function signBody(body: Omit<CursorPayload, "mac">, secret: string) {
  return createHmac("sha256", secret).update(JSON.stringify(body)).digest("base64url");
}

function macMatches(expected: string, actual: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Opaque, versioned keyset cursor codec. Decode validates that a cursor belongs to this exact query.
 *  When CONDUIT_CURSOR_SECRET is set (>=16 chars), cursors are HMAC-signed and unsigned cursors are rejected.
 *  Without the secret, encoding stays compatible with existing unsigned cursors. */
export const cursorCodec = {
  encode(payload: CursorPayload): string {
    const { mac: _ignored, ...body } = payload;
    const secret = cursorSecret();
    const signed = secret ? { ...body, mac: signBody(body, secret) } : body;
    return Buffer.from(JSON.stringify(signed), "utf8").toString("base64url");
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
      const secret = cursorSecret();
      if (secret) {
        const body: Omit<CursorPayload, "mac"> = {
          version: 1,
          collection: value.collection as CursorCollection,
          projectId: value.projectId ?? null,
          filters: value.filters as Record<string, string>,
          order: value.order as CursorOrder,
          sort: value.sort as { time: string; id: string },
        };
        if (!value.mac || !macMatches(signBody(body, secret), value.mac)) throw new Error("invalid_cursor");
      }
      return value as CursorPayload;
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_cursor") throw error;
      throw new Error("invalid_cursor");
    }
  },
};

export function pageLimit(limit = 50, max = 200) { return Math.max(1, Math.min(limit, max, 200)); }
export function cursorOrder(collection: CursorCollection) { return orders[collection]; }
