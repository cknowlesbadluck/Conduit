import { listActivity, type ActivityEvent } from "./store.js";

type Listener = (event: ActivityEvent) => void;
type Filter = { projectId?: string };

type Subscription = { filter: Filter; listener: Listener };

const listeners = new Set<Subscription>();
// Performance Optimization: Maintain a Copy-On-Write snapshot array of active subscriptions.
// Since subscriptions change rarely relative to event dispatches, updating activeListeners on
// subscribe/unsubscribe avoids temporary array allocations on every publishEvent call while preserving
// strict listener snapshot semantics during dispatch.
let activeListeners: Subscription[] = [];
const MAX_SUBSCRIBERS = Number(process.env.CONDUIT_MAX_EVENT_SUBSCRIBERS ?? 100);

export function publishEvent(event: ActivityEvent) {
  for (const subscription of activeListeners) {
    if (subscription.filter.projectId && subscription.filter.projectId !== event.projectId) continue;
    try { subscription.listener(event); } catch { /* disconnecting clients must not break publishers */ }
  }
}

export function subscribeEvents(filter: Filter, listener: Listener) {
  if (listeners.size >= MAX_SUBSCRIBERS) throw new Error("event_subscriber_limit_reached");
  const subscription = { filter, listener };
  listeners.add(subscription);
  activeListeners = [...listeners];
  return () => {
    if (listeners.delete(subscription)) {
      activeListeners = [...listeners];
    }
  };
}

export function subscriberCount() { return listeners.size; }

export async function replayRecentEvents(projectId?: string) {
  return listActivity(50, projectId);
}
