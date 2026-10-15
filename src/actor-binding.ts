export function actorBindingKey(clientId?: string, sub?: string) {
  if (clientId && sub && clientId !== sub) return `${clientId}::${sub}`;
  return sub ?? clientId;
}

// Performance Optimization: Return direct array literals instead of allocating and pushing to a dynamic array.
/** Composite key first, then legacy JWT sub so existing production bindings still resolve. */
export function actorBindingLookupKeys(clientId?: string, sub?: string): string[] {
  const primary = actorBindingKey(clientId, sub);
  if (!primary) return [];
  if (sub && sub !== primary) return [primary, sub];
  return [primary];
}
