/**
 * Real-time Events Example
 *
 * Demonstrates:
 * - SSE (Server-Sent Events) subscription
 * - WebSocket subscription
 * - Event filtering by queue
 * - Auto-reconnect handling
 *
 * Run: bun run examples/events.ts
 */

import {
  FlashQ,
  EventSubscriber,
  createEventSubscriber,
  createWebSocketSubscriber,
  subscribeToEvents,
} from '../src';

async function main() {
  console.log('='.repeat(60));
  console.log('flashQ Real-time Events Demo');
  console.log('='.repeat(60));

  const client = new FlashQ({ host: 'localhost', port: 6789 });
  await client.connect();

  // ============================================================
  // 1. SSE Event Subscriber (Recommended for most use cases)
  // ============================================================
  console.log('\n1. SSE Event Subscriber\n');

  const sseEvents = new EventSubscriber({
    host: 'localhost',
    httpPort: 6790,
    type: 'sse',
    autoReconnect: true,
    reconnectDelay: 1000,
    maxReconnectAttempts: 5,
  });

  // Connection lifecycle events
  sseEvents.on('connected', () => {
    console.log('[SSE] Connected to event stream');
  });

  sseEvents.on('disconnected', () => {
    console.log('[SSE] Disconnected from event stream');
  });

  sseEvents.on('reconnecting', (attempt) => {
    console.log(`[SSE] Reconnecting... attempt ${attempt}`);
  });

  sseEvents.on('error', (error) => {
    console.log(`[SSE] Error: ${error.message}`);
  });

  // Job lifecycle events
  sseEvents.on('pushed', (event) => {
    console.log(`[SSE] Job ${event.jobId} pushed to ${event.queue}`);
  });

  sseEvents.on('completed', (event) => {
    console.log(`[SSE] Job ${event.jobId} completed`);
  });

  sseEvents.on('failed', (event) => {
    console.log(`[SSE] Job ${event.jobId} failed: ${event.error}`);
  });

  sseEvents.on('progress', (event) => {
    console.log(`[SSE] Job ${event.jobId} progress: ${event.progress}%`);
  });

  sseEvents.on('timeout', (event) => {
    console.log(`[SSE] Job ${event.jobId} timed out`);
  });

  // Generic event handler (receives all events)
  sseEvents.on('event', (event) => {
    console.log(`[SSE] Event: ${event.eventType} for job ${event.jobId}`);
  });

  try {
    await sseEvents.connect();
    console.log('SSE subscriber connected!');
  } catch (error) {
    console.log('SSE not available (server may not have HTTP enabled)');
  }

  // ============================================================
  // 2. WebSocket Event Subscriber (Lower latency, bidirectional)
  // ============================================================
  console.log('\n2. WebSocket Event Subscriber\n');

  const wsEvents = new EventSubscriber({
    host: 'localhost',
    httpPort: 6790,
    type: 'websocket',
    // Optional: authenticate with token
    // token: 'your-auth-token',
  });

  wsEvents.on('connected', () => {
    console.log('[WS] Connected to WebSocket');
  });

  wsEvents.on('completed', (event) => {
    console.log(`[WS] Job ${event.jobId} completed`);
  });

  try {
    await wsEvents.connect();
    console.log('WebSocket subscriber connected!');
  } catch (error) {
    console.log('WebSocket not available (server may not have HTTP enabled)');
  }

  // ============================================================
  // 3. Queue-Filtered Subscription
  // ============================================================
  console.log('\n3. Queue-Filtered Subscription\n');

  const emailEvents = new EventSubscriber({
    host: 'localhost',
    httpPort: 6790,
    queue: 'emails', // Only receive events for this queue
  });

  emailEvents.on('completed', (event) => {
    console.log(`[Emails] Job ${event.jobId} completed`);
  });

  try {
    await emailEvents.connect();
    console.log('Email queue subscriber connected!');
  } catch (error) {
    console.log('Queue subscription not available');
  }

  // ============================================================
  // 4. Convenience Functions
  // ============================================================
  console.log('\n4. Convenience Functions\n');

  // One-liner SSE subscriber
  const quickSSE = createEventSubscriber({ queue: 'notifications' });
  quickSSE.on('completed', (e) => console.log(`[Quick SSE] ${e.jobId} done`));

  // One-liner WebSocket subscriber
  const quickWS = createWebSocketSubscriber({ queue: 'alerts' });
  quickWS.on('failed', (e) => console.log(`[Quick WS] ${e.jobId} failed`));

  // Callback-based subscription (returns cleanup function)
  try {
    const unsubscribe = await subscribeToEvents(
      { queue: 'orders' },
      (event) => {
        console.log(`[Callback] ${event.eventType}: ${event.jobId}`);
      }
    );
    console.log('Callback subscription active');

    // Cleanup later: unsubscribe();
  } catch (error) {
    console.log('Callback subscription not available');
  }

  // ============================================================
  // 5. Using Client Helper Methods
  // ============================================================
  console.log('\n5. Client Helper Methods\n');

  // Subscribe to all events via client
  const allEvents = client.subscribe();
  allEvents.on('event', (e) => {
    console.log(`[Client] ${e.eventType} on ${e.queue}: job ${e.jobId}`);
  });

  // Subscribe to specific queue via WebSocket
  const queueWs = client.subscribeWs('payments');
  queueWs.on('completed', (e) => {
    console.log(`[Client WS] Payment job ${e.jobId} completed`);
  });

  // ============================================================
  // 6. Push Some Jobs to Trigger Events
  // ============================================================
  console.log('\n6. Pushing test jobs...\n');

  // Wait a bit for connections to establish
  await new Promise((r) => setTimeout(r, 500));

  await client.push('emails', { to: 'user@example.com', subject: 'Hello' });
  await client.push('notifications', { type: 'welcome', userId: 123 });
  await client.push('orders', { orderId: 'ORD-001', total: 99.99 });

  console.log('Pushed 3 test jobs. Watch for events above!');

  // Wait for events to arrive
  await new Promise((r) => setTimeout(r, 2000));

  // ============================================================
  // Cleanup
  // ============================================================
  console.log('\nCleaning up...');

  sseEvents.close();
  wsEvents.close();
  emailEvents.close();
  quickSSE.close();
  quickWS.close();
  allEvents.close();
  queueWs.close();

  await client.close();

  console.log('\nDone!');
}

main().catch(console.error);
