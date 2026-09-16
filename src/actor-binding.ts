export function actorBindingKey(clientId?: string, sub?: string) {
  if (clientId && sub && clientId !== sub) return `${clientId}::${sub}`;
  return sub ?? clientId;
}
