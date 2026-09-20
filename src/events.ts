import { listActivity, type ActivityEvent } from "./store.js";

type Listener = (event: ActivityEvent) => void;
type Filter = { projectId?: string };

const listeners = new Set<{ filter: Filter; listener: Listener }>();
const MAX_SUBSCRIBERS = Number(process.env.CONDUIT_MAX_EVENT_SUBSCRIBERS ?? 100);

export function publishEvent(event: ActivityEvent) {
  // Performance Optimization: Iterate directly over the Set instead of creating
  // a temporary array spread ([...listeners]) on every published event, eliminating array
  // allocations and GC pressure under high event throughput.
  for (const subscription of listeners) {
    if (subscription.filter.projectId && subscription.filter.projectId !== event.projectId) continue;
    try { subscription.listener(event); } catch { /* disconnecting clients must not break publishers */ }
  }
}

export function subscribeEvents(filter: Filter, listener: Listener) {
  if (listeners.size >= MAX_SUBSCRIBERS) throw new Error("event_subscriber_limit_reached");
  const subscription = { filter, listener };
  listeners.add(subscription);
  return () => listeners.delete(subscription);
}

export function subscriberCount() { return listeners.size; }

export async function replayRecentEvents(projectId?: string) {
  return listActivity(50, projectId);
}
