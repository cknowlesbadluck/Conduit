export function actorBindingKey(clientId?: string, sub?: string) {
  if (clientId && sub && clientId !== sub) return `${clientId}::${sub}`;
  return sub ?? clientId;
}

/** Composite key first, then legacy JWT sub so existing production bindings still resolve. */
export function actorBindingLookupKeys(clientId?: string, sub?: string): string[] {
  // Performance Optimization: Fast-path primary lookup keys without intermediate array push allocations.
  if (!clientId && !sub) return [];
  if (!clientId) return [sub!];
  if (!sub || clientId === sub) return [clientId];

  // Composite key case: primary is `${clientId}::${sub}` and sub is secondary lookup
  return [`${clientId}::${sub}`, sub];
}
