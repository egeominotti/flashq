/**
 * TCP protocol handler for FlashQ client.
 *
 * Handles buffer management, message framing, and protocol serialization
 * for both JSON (newline-delimited) and binary (MessagePack) protocols.
 */

import { encode, decode } from '@msgpack/msgpack';

/**
 * Pending request tracking for async responses.
 */
export interface PendingRequest {
  /** Resolves with the response data */
  resolve: (value: unknown) => void;
  /** Rejects with an error */
  reject: (error: Error) => void;
  /** Timeout timer handle */
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Handles JSON protocol buffer parsing.
 *
 * Accumulates incoming data chunks and extracts complete
 * newline-delimited JSON messages.
 */
export class JsonBufferHandler {
  /** Accumulated string chunks waiting to be joined */
  private chunks: string[] = [];
  /** Partial line from previous parse */
  private remainder = '';

  /**
   * Appends new data to the buffer.
   *
   * @param data - Raw data from socket
   */
  append(data: Buffer | string): void {
    this.chunks.push(typeof data === 'string' ? data : data.toString());
  }

  /**
   * Extracts all complete lines from the buffer.
   *
   * Complete lines are separated by newlines. Any partial line
   * at the end is kept for the next call.
   *
   * @returns Array of complete JSON strings
   */
  extractLines(): string[] {
    // Join chunks only when processing (more efficient than += on each chunk)
    const fullBuffer = this.remainder + this.chunks.join('');
    this.chunks.length = 0; // Clear array without reallocating

    const lines = fullBuffer.split('\n');
    this.remainder = lines.pop() ?? '';

    return lines.filter((line) => line.trim());
  }

  /**
   * Resets the buffer state.
   */
  reset(): void {
    this.chunks.length = 0;
    this.remainder = '';
  }
}

/**
 * Handles binary (MessagePack) protocol buffer parsing.
 *
 * Each message is framed with a 4-byte big-endian length prefix
 * followed by the MessagePack-encoded payload.
 */
export class BinaryBufferHandler {
  /** Accumulated binary data */
  private buffer: Buffer = Buffer.alloc(0);

  /**
   * Appends new data to the buffer.
   *
   * @param data - Raw data from socket
   */
  append(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
  }

  /**
   * Extracts all complete frames from the buffer.
   *
   * Frame format: [4-byte length BE][payload]
   *
   * @returns Array of decoded message objects
   */
  extractFrames(): Record<string, unknown>[] {
    const frames: Record<string, unknown>[] = [];

    while (this.buffer.length >= 4) {
      const len = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + len) break;

      const frameData = this.buffer.subarray(4, 4 + len);
      this.buffer = this.buffer.subarray(4 + len);

      frames.push(decode(frameData) as Record<string, unknown>);
    }

    return frames;
  }

  /**
   * Resets the buffer state.
   */
  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}

/**
 * Encodes a command for TCP transmission.
 *
 * @param command - Command object to encode
 * @param reqId - Request ID to include
 * @param useBinary - Whether to use MessagePack encoding
 * @returns Buffer ready for socket.write()
 */
export function encodeCommand(
  command: Record<string, unknown>,
  reqId: string,
  useBinary: boolean
): Buffer {
  const payload = { ...command, reqId };

  if (useBinary) {
    const encoded = encode(payload);
    const frame = Buffer.alloc(4 + encoded.length);
    frame.writeUInt32BE(encoded.length, 0);
    frame.set(encoded, 4);
    return frame;
  }

  return Buffer.from(JSON.stringify(payload) + '\n');
}

/**
 * Parses a JSON response from a string.
 *
 * @param line - JSON string to parse
 * @returns Parsed response object or null if invalid
 */
export function parseJsonResponse(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** Counter for generating unique request IDs */
let requestIdCounter = 0;

/**
 * Generates a unique request ID.
 *
 * Format: "r{incrementing number}"
 *
 * @returns Unique request ID string
 */
export function generateRequestId(): string {
  return `r${++requestIdCounter}`;
}

/**
 * Resets the request ID counter.
 * Primarily used for testing.
 */
export function resetRequestIdCounter(): void {
  requestIdCounter = 0;
}
