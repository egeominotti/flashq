/**
 * Pub/Sub operations for FlashQ client.
 * Redis-like publish/subscribe messaging.
 */

import type { FlashQConnection } from './connection';

/**
 * Publish a message to a channel.
 * @returns Number of subscribers that received the message.
 */
export async function publish(
  client: FlashQConnection,
  channel: string,
  message: unknown
): Promise<number> {
  const response = await client.send({ cmd: 'PUB', channel, message });
  if (!response.ok) {
    throw new Error((response as { error?: string }).error || 'Publish failed');
  }
  return (response as { receivers: number }).receivers;
}

/**
 * Subscribe to channels.
 * @returns List of subscribed channels.
 */
export async function subscribe(
  client: FlashQConnection,
  channels: string[]
): Promise<string[]> {
  const response = await client.send({ cmd: 'SUB', channels });
  if (!response.ok) {
    throw new Error((response as { error?: string }).error || 'Subscribe failed');
  }
  return (response as { channels: string[] }).channels;
}

/**
 * Subscribe to patterns (e.g., "events:*").
 * @returns List of subscribed patterns.
 */
export async function psubscribe(
  client: FlashQConnection,
  patterns: string[]
): Promise<string[]> {
  const response = await client.send({ cmd: 'PSUB', patterns });
  if (!response.ok) {
    throw new Error((response as { error?: string }).error || 'Pattern subscribe failed');
  }
  return (response as { channels: string[] }).channels;
}

/**
 * Unsubscribe from channels.
 * @returns List of unsubscribed channels.
 */
export async function unsubscribe(
  client: FlashQConnection,
  channels: string[]
): Promise<string[]> {
  const response = await client.send({ cmd: 'UNSUB', channels });
  if (!response.ok) {
    throw new Error((response as { error?: string }).error || 'Unsubscribe failed');
  }
  return (response as { channels: string[] }).channels;
}

/**
 * Unsubscribe from patterns.
 * @returns List of unsubscribed patterns.
 */
export async function punsubscribe(
  client: FlashQConnection,
  patterns: string[]
): Promise<string[]> {
  const response = await client.send({ cmd: 'PUNSUB', patterns });
  if (!response.ok) {
    throw new Error((response as { error?: string }).error || 'Pattern unsubscribe failed');
  }
  return (response as { channels: string[] }).channels;
}

/**
 * List active channels.
 * @param pattern - Optional glob pattern to filter channels
 * @returns Array of active channel names
 */
export async function channels(
  client: FlashQConnection,
  pattern?: string
): Promise<string[]> {
  const response = await client.send({ cmd: 'PUBSUBCHANNELS', pattern });
  if (!response.ok) {
    throw new Error((response as { error?: string }).error || 'Channels list failed');
  }
  return (response as { channels: string[] }).channels;
}

/**
 * Get subscriber counts for channels.
 * @returns Array of [channel, count] tuples
 */
export async function numsub(
  client: FlashQConnection,
  channelNames: string[]
): Promise<Array<[string, number]>> {
  const response = await client.send({ cmd: 'PUBSUBNUMSUB', channels: channelNames });
  if (!response.ok) {
    throw new Error((response as { error?: string }).error || 'Numsub failed');
  }
  return (response as { counts: Array<[string, number]> }).counts;
}
