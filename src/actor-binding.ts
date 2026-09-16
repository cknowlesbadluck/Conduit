export function actorBindingKey(clientId?: string, sub?: string) {
  if (clientId && sub && clientId !== sub) return `${clientId}::${sub}`;
  return sub ?? clientId;
}

/** Composite key first, then legacy JWT sub so existing production bindings still resolve. */
export function actorBindingLookupKeys(clientId?: string, sub?: string): string[] {
  const primary = actorBindingKey(clientId, sub);
  const keys: string[] = [];
  if (primary) keys.push(primary);
  if (sub && sub !== primary) keys.push(sub);
  return keys;
}
