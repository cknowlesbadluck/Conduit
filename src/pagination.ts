export type Page<T> = { items: T[]; nextCursor?: string };

const DEFAULT_LIMIT = 50;
const DEFAULT_MAX = 200;

export function pageWindow(options: { limit?: number; cursor?: string; max?: number } = {}): { limit: number; offset: number } {
  const max = Math.max(1, Math.min(options.max ?? DEFAULT_MAX, DEFAULT_MAX));
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, max));
  let offset = 0;
  if (options.cursor) {
    const decoded = Number.parseInt(Buffer.from(options.cursor, "base64url").toString("utf8"), 10);
    if (!Number.isSafeInteger(decoded) || decoded < 0) throw new Error("invalid_cursor");
    offset = decoded;
  }
  return { limit, offset };
}

export function paginate<T>(items: T[], options: { limit?: number; cursor?: string; max?: number } = {}): Page<T> {
  const { limit, offset } = pageWindow(options);
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return { items: page, ...(nextOffset < items.length ? { nextCursor: Buffer.from(String(nextOffset), "utf8").toString("base64url") } : {}) };
}

export function pageFromWindow<T>(window: T[], limit: number, offset: number): Page<T> {
  const hasMore = window.length > limit;
  const items = hasMore ? window.slice(0, limit) : window;
  return { items, ...(hasMore ? { nextCursor: Buffer.from(String(offset + items.length), "utf8").toString("base64url") } : {}) };
}
