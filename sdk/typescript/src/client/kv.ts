/**
 * Key-Value storage operations for FlashQ client
 *
 * Redis-like KV store with TTL support and batch operations.
 */
import type { FlashQConnection } from './connection';

export interface KvSetOptions {
  /** Time-to-live in milliseconds */
  ttl?: number;
}

export interface KvEntry {
  key: string;
  value: unknown;
  ttl?: number;
}

// ============== Core Operations ==============

/**
 * Set a key-value pair.
 */
export async function set(
  client: FlashQConnection,
  key: string,
  value: unknown,
  options: KvSetOptions = {}
): Promise<void> {
  await client.send({
    cmd: 'KVSET',
    key,
    value,
    ttl: options.ttl,
  });
}

/**
 * Get a value by key.
 */
export async function get<T = unknown>(
  client: FlashQConnection,
  key: string
): Promise<T | null> {
  const response = await client.send<{ ok: boolean; value: T | null }>({
    cmd: 'KVGET',
    key,
  });
  return response.value ?? null;
}

/**
 * Delete a key.
 */
export async function del(
  client: FlashQConnection,
  key: string
): Promise<boolean> {
  const response = await client.send<{ ok: boolean; exists: boolean }>({
    cmd: 'KVDEL',
    key,
  });
  return response.exists;
}

/**
 * Check if a key exists.
 */
export async function exists(
  client: FlashQConnection,
  key: string
): Promise<boolean> {
  const response = await client.send<{ ok: boolean; exists: boolean }>({
    cmd: 'KVEXISTS',
    key,
  });
  return response.exists;
}

// ============== TTL Operations ==============

/**
 * Set TTL on an existing key.
 */
export async function expire(
  client: FlashQConnection,
  key: string,
  ttl: number
): Promise<boolean> {
  const response = await client.send<{ ok: boolean; exists: boolean }>({
    cmd: 'KVEXPIRE',
    key,
    ttl,
  });
  return response.exists;
}

/**
 * Get remaining TTL for a key.
 * Returns: milliseconds remaining, -1 if no TTL, -2 if key doesn't exist.
 */
export async function ttl(
  client: FlashQConnection,
  key: string
): Promise<number> {
  const response = await client.send<{ ok: boolean; ttl: number }>({
    cmd: 'KVTTL',
    key,
  });
  return response.ttl;
}

// ============== Batch Operations ==============

/**
 * Get multiple values by keys (MGET).
 */
export async function mget<T = unknown>(
  client: FlashQConnection,
  keys: string[]
): Promise<(T | null)[]> {
  const response = await client.send<{ ok: boolean; values: (T | null)[] }>({
    cmd: 'KVMGET',
    keys,
  });
  return response.values;
}

/**
 * Set multiple key-value pairs (MSET).
 */
export async function mset(
  client: FlashQConnection,
  entries: KvEntry[]
): Promise<number> {
  const response = await client.send<{ ok: boolean; count: number }>({
    cmd: 'KVMSET',
    entries,
  });
  return response.count;
}

// ============== Pattern Matching ==============

/**
 * List keys matching a pattern.
 * Supports glob patterns: * (any chars), ? (one char)
 */
export async function keys(
  client: FlashQConnection,
  pattern?: string
): Promise<string[]> {
  const response = await client.send<{ ok: boolean; keys: string[] }>({
    cmd: 'KVKEYS',
    pattern,
  });
  return response.keys;
}

// ============== Atomic Operations ==============

/**
 * Increment a numeric value.
 * If key doesn't exist, creates it with value = by.
 */
export async function incr(
  client: FlashQConnection,
  key: string,
  by: number = 1
): Promise<number> {
  const response = await client.send<{ ok: boolean; value: number }>({
    cmd: 'KVINCR',
    key,
    by,
  });
  return response.value;
}

/**
 * Decrement a numeric value.
 */
export async function decr(
  client: FlashQConnection,
  key: string,
  by: number = 1
): Promise<number> {
  return incr(client, key, -by);
}
