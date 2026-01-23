/**
 * flashQ Events - Real-time event subscriptions.
 *
 * @example
 * ```typescript
 * import { EventSubscriber } from 'flashq';
 *
 * const events = new EventSubscriber({ host: 'localhost', httpPort: 6790 });
 * events.on('completed', (event) => console.log(`Job ${event.jobId} completed`));
 * await events.connect();
 * ```
 */

export * from './types';
export { EventSubscriber } from './subscriber';

import { EventSubscriber } from './subscriber';
import type { EventSubscriberOptions, JobEvent } from './types';

/** Create an SSE event subscriber */
export function createEventSubscriber(options?: EventSubscriberOptions): EventSubscriber {
  return new EventSubscriber({ ...options, type: 'sse' });
}

/** Create a WebSocket event subscriber */
export function createWebSocketSubscriber(options?: EventSubscriberOptions): EventSubscriber {
  return new EventSubscriber({ ...options, type: 'websocket' });
}

/** Subscribe to events with a simple callback */
export async function subscribeToEvents(
  options: EventSubscriberOptions,
  callback: (event: JobEvent) => void
): Promise<() => void> {
  const subscriber = new EventSubscriber(options);
  subscriber.on('event', callback);
  await subscriber.connect();
  return () => subscriber.close();
}

export default EventSubscriber;
