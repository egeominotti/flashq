/**
 * FlashQ Pub/Sub Example
 *
 * Demonstrates Redis-like publish/subscribe messaging.
 */
import { FlashQ } from '../src';

async function main() {
  const client = new FlashQ();
  await client.connect();

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              FlashQ Pub/Sub Example                          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // ============== Test 1: Basic Publish ==============
  console.log('━━━ Test 1: Basic Publish ━━━');

  // Publish without subscribers
  let receivers = await client.publish('notifications', {
    type: 'alert',
    message: 'Hello, World!',
  });
  console.log(`  Published to ${receivers} subscribers (expected: 0)`);

  // ============== Test 2: Subscribe and Publish ==============
  console.log('\n━━━ Test 2: Subscribe and Publish ━━━');

  // Subscribe to a channel
  const subscribed = await client.pubsubSubscribe(['notifications']);
  console.log(`  Subscribed to channels: ${subscribed.join(', ')}`);

  // Publish to the channel
  receivers = await client.publish('notifications', {
    type: 'info',
    message: 'You have a new message!',
  });
  console.log(`  Published to ${receivers} subscribers`);

  // ============== Test 3: Pattern Subscribe ==============
  console.log('\n━━━ Test 3: Pattern Subscribe ━━━');

  // Subscribe to pattern
  const patterns = await client.pubsubPsubscribe(['events:*', 'logs:*']);
  console.log(`  Pattern subscribed: ${patterns.join(', ')}`);

  // Publish to matching channels
  let count1 = await client.publish('events:user:signup', { userId: 123 });
  let count2 = await client.publish('events:user:login', { userId: 456 });
  let count3 = await client.publish('logs:error', { error: 'Something went wrong' });
  console.log(`  Published to events:user:signup: ${count1} receivers`);
  console.log(`  Published to events:user:login: ${count2} receivers`);
  console.log(`  Published to logs:error: ${count3} receivers`);

  // ============== Test 4: List Channels ==============
  console.log('\n━━━ Test 4: List Active Channels ━━━');

  // List all channels
  const allChannels = await client.pubsubChannels();
  console.log(`  All active channels: ${allChannels.length > 0 ? allChannels.join(', ') : '(none)'}`);

  // List channels matching pattern
  const eventChannels = await client.pubsubChannels('events:*');
  console.log(`  Channels matching "events:*": ${eventChannels.length > 0 ? eventChannels.join(', ') : '(none)'}`);

  // ============== Test 5: Subscriber Count ==============
  console.log('\n━━━ Test 5: Subscriber Count ━━━');

  const counts = await client.pubsubNumsub(['notifications', 'alerts', 'missing']);
  for (const [channel, count] of counts) {
    console.log(`  ${channel}: ${count} subscribers`);
  }

  // ============== Test 6: Unsubscribe ==============
  console.log('\n━━━ Test 6: Unsubscribe ━━━');

  const unsubscribed = await client.pubsubUnsubscribe(['notifications']);
  console.log(`  Unsubscribed from: ${unsubscribed.join(', ')}`);

  const punsubscribed = await client.pubsubPunsubscribe(['events:*']);
  console.log(`  Pattern unsubscribed from: ${punsubscribed.join(', ')}`);

  // ============== Test 7: Multiple Publishers ==============
  console.log('\n━━━ Test 7: Multiple Publishers ━━━');

  // Create another client
  const client2 = new FlashQ();
  await client2.connect();

  // Subscribe from client 1
  await client.pubsubSubscribe(['chat']);

  // Publish from client 2
  receivers = await client2.publish('chat', { user: 'Alice', message: 'Hello!' });
  console.log(`  Client 2 published to ${receivers} subscribers`);

  await client2.close();

  // ============== Summary ==============
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                        Summary                               ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Pub/Sub provides real-time messaging between clients.       ║');
  console.log('║  Use publish() to send messages to channels.                 ║');
  console.log('║  Use pubsubSubscribe() for exact channel matching.           ║');
  console.log('║  Use pubsubPsubscribe() for pattern matching (e.g., "a:*").  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  await client.close();
}

main().catch(console.error);
