import { listActivity, type ActivityEvent } from "./store.js";

type Listener = (event: ActivityEvent) => void;
type Filter = { projectId?: string };

const listeners = new Set<{ filter: Filter; listener: Listener }>();

export function publishEvent(event: ActivityEvent) {
  for (const subscription of [...listeners]) {
    if (subscription.filter.projectId && subscription.filter.projectId !== event.projectId) continue;
    try { subscription.listener(event); } catch { /* disconnecting clients must not break publishers */ }
  }
}

export function subscribeEvents(filter: Filter, listener: Listener) {
  const subscription = { filter, listener };
  listeners.add(subscription);
  return () => listeners.delete(subscription);
}

export function subscriberCount() { return listeners.size; }

export async function replayRecentEvents(projectId?: string) {
  return listActivity(50, projectId);
}
