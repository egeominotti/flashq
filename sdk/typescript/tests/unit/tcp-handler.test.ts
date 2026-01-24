/**
 * TCP Protocol Handler Tests
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import {
  JsonBufferHandler,
  BinaryBufferHandler,
  RequestIdGenerator,
  encodeCommand,
  parseJsonResponse,
  generateRequestId,
  resetRequestIdCounter,
} from '../../src/client/tcp/handler';
import { decode, encode } from '@msgpack/msgpack';

describe('JsonBufferHandler', () => {
  let handler: JsonBufferHandler;

  beforeEach(() => {
    handler = new JsonBufferHandler();
  });

  test('extracts single complete line', () => {
    handler.append('{"cmd":"PING"}\n');
    const lines = handler.extractLines();

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('{"cmd":"PING"}');
  });

  test('extracts multiple complete lines', () => {
    handler.append('{"cmd":"PING"}\n{"cmd":"PONG"}\n{"cmd":"ACK"}\n');
    const lines = handler.extractLines();

    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('{"cmd":"PING"}');
    expect(lines[1]).toBe('{"cmd":"PONG"}');
    expect(lines[2]).toBe('{"cmd":"ACK"}');
  });

  test('handles partial lines across multiple appends', () => {
    handler.append('{"cmd":');
    let lines = handler.extractLines();
    expect(lines).toHaveLength(0);

    handler.append('"PING"}\n');
    lines = handler.extractLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('{"cmd":"PING"}');
  });

  test('handles mixed complete and partial lines', () => {
    handler.append('{"cmd":"PING"}\n{"cmd":"P');
    let lines = handler.extractLines();

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('{"cmd":"PING"}');

    handler.append('ONG"}\n');
    lines = handler.extractLines();

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('{"cmd":"PONG"}');
  });

  test('handles Buffer input', () => {
    handler.append(Buffer.from('{"ok":true}\n'));
    const lines = handler.extractLines();

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('{"ok":true}');
  });

  test('filters empty lines', () => {
    handler.append('{"cmd":"A"}\n\n\n{"cmd":"B"}\n');
    const lines = handler.extractLines();

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('{"cmd":"A"}');
    expect(lines[1]).toBe('{"cmd":"B"}');
  });

  test('reset clears buffer state', () => {
    handler.append('{"partial":');
    handler.reset();
    handler.append('{"complete":true}\n');

    const lines = handler.extractLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('{"complete":true}');
  });

  test('handles rapid chunk accumulation', () => {
    // Simulate many small chunks
    const parts = '{"cmd":"TEST"}\n'.split('');
    for (const part of parts) {
      handler.append(part);
    }

    const lines = handler.extractLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('{"cmd":"TEST"}');
  });
});

describe('BinaryBufferHandler', () => {
  let handler: BinaryBufferHandler;

  beforeEach(() => {
    handler = new BinaryBufferHandler();
  });

  function createFrame(data: Record<string, unknown>): Buffer {
    const encoded = encode(data);
    const frame = Buffer.alloc(4 + encoded.length);
    frame.writeUInt32BE(encoded.length, 0);
    frame.set(encoded, 4);
    return frame;
  }

  test('extracts single complete frame', () => {
    const frame = createFrame({ cmd: 'PING' });
    handler.append(frame);

    const frames = handler.extractFrames();
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ cmd: 'PING' });
  });

  test('extracts multiple complete frames', () => {
    const frame1 = createFrame({ cmd: 'A' });
    const frame2 = createFrame({ cmd: 'B' });
    const frame3 = createFrame({ cmd: 'C' });

    handler.append(Buffer.concat([frame1, frame2, frame3]));
    const frames = handler.extractFrames();

    expect(frames).toHaveLength(3);
    expect(frames[0]).toEqual({ cmd: 'A' });
    expect(frames[1]).toEqual({ cmd: 'B' });
    expect(frames[2]).toEqual({ cmd: 'C' });
  });

  test('handles partial frame across multiple appends', () => {
    const frame = createFrame({ cmd: 'TEST', data: { large: 'payload' } });

    // Split frame into two parts
    const part1 = frame.subarray(0, 10);
    const part2 = frame.subarray(10);

    handler.append(part1);
    let frames = handler.extractFrames();
    expect(frames).toHaveLength(0);

    handler.append(part2);
    frames = handler.extractFrames();
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ cmd: 'TEST', data: { large: 'payload' } });
  });

  test('handles partial length header', () => {
    const frame = createFrame({ ok: true });

    // Append only 2 bytes of the 4-byte length header
    handler.append(frame.subarray(0, 2));
    let frames = handler.extractFrames();
    expect(frames).toHaveLength(0);

    // Append the rest
    handler.append(frame.subarray(2));
    frames = handler.extractFrames();
    expect(frames).toHaveLength(1);
  });

  test('reset clears buffer state', () => {
    const partialFrame = createFrame({ partial: true }).subarray(0, 5);
    handler.append(partialFrame);
    handler.reset();

    const completeFrame = createFrame({ complete: true });
    handler.append(completeFrame);

    const frames = handler.extractFrames();
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ complete: true });
  });

  test('handles complex nested data', () => {
    const complexData = {
      cmd: 'PUSH',
      queue: 'test',
      data: {
        nested: {
          array: [1, 2, 3],
          object: { a: 'b' },
        },
        timestamp: Date.now(),
      },
    };

    handler.append(createFrame(complexData));
    const frames = handler.extractFrames();

    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(complexData);
  });
});

describe('encodeCommand', () => {
  beforeEach(() => {
    resetRequestIdCounter();
  });

  test('encodes JSON command with newline', () => {
    const buffer = encodeCommand({ cmd: 'PING' }, 'r1', false);
    const str = buffer.toString();

    expect(str).toContain('"cmd":"PING"');
    expect(str).toContain('"reqId":"r1"');
    expect(str).toEndWith('\n');
  });

  test('encodes binary command with length prefix', () => {
    const buffer = encodeCommand({ cmd: 'PING' }, 'r1', true);

    // First 4 bytes are length
    const length = buffer.readUInt32BE(0);
    expect(buffer.length).toBe(4 + length);

    // Decode payload
    const payload = decode(buffer.subarray(4)) as Record<string, unknown>;
    expect(payload.cmd).toBe('PING');
    expect(payload.reqId).toBe('r1');
  });

  test('preserves all command properties', () => {
    const command = {
      cmd: 'PUSH',
      queue: 'test',
      data: { foo: 'bar' },
      options: { priority: 5 },
    };

    const buffer = encodeCommand(command, 'r42', false);
    const parsed = JSON.parse(buffer.toString().trim());

    expect(parsed.cmd).toBe('PUSH');
    expect(parsed.queue).toBe('test');
    expect(parsed.data).toEqual({ foo: 'bar' });
    expect(parsed.options).toEqual({ priority: 5 });
    expect(parsed.reqId).toBe('r42');
  });
});

describe('parseJsonResponse', () => {
  test('parses valid JSON', () => {
    const result = parseJsonResponse('{"ok":true,"data":123}');

    expect(result).not.toBeNull();
    expect(result?.ok).toBe(true);
    expect(result?.data).toBe(123);
  });

  test('returns null for invalid JSON', () => {
    expect(parseJsonResponse('not json')).toBeNull();
    expect(parseJsonResponse('{"incomplete":')).toBeNull();
    expect(parseJsonResponse('')).toBeNull();
  });

  test('handles complex objects', () => {
    const json = JSON.stringify({
      ok: true,
      job: { id: 1, queue: 'test', data: { nested: [1, 2, 3] } },
    });

    const result = parseJsonResponse(json);
    expect(result?.ok).toBe(true);
    expect((result?.job as Record<string, unknown>).id).toBe(1);
  });
});

describe('RequestIdGenerator', () => {
  test('generates unique incrementing IDs', () => {
    const generator = new RequestIdGenerator();
    const id1 = generator.generate();
    const id2 = generator.generate();
    const id3 = generator.generate();

    // IDs should be unique
    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);

    // IDs should end with incrementing numbers
    expect(id1).toMatch(/-1$/);
    expect(id2).toMatch(/-2$/);
    expect(id3).toMatch(/-3$/);
  });

  test('different instances have different prefixes', () => {
    const gen1 = new RequestIdGenerator();
    const gen2 = new RequestIdGenerator();

    const id1 = gen1.generate();
    const id2 = gen2.generate();

    // Prefixes should be different (contains unique timestamp/random)
    const prefix1 = id1.split('-').slice(0, 2).join('-');
    const prefix2 = id2.split('-').slice(0, 2).join('-');
    expect(prefix1).not.toBe(prefix2);
  });

  test('reset() resets counter but keeps prefix', () => {
    const generator = new RequestIdGenerator();
    generator.generate();
    generator.generate();

    generator.reset();

    const id = generator.generate();
    expect(id).toMatch(/-1$/);
  });
});

describe('generateRequestId (legacy)', () => {
  beforeEach(() => {
    resetRequestIdCounter();
  });

  test('generates unique IDs', () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    const id3 = generateRequestId();

    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
  });

  test('IDs have incrementing suffix after reset', () => {
    resetRequestIdCounter();

    const id1 = generateRequestId();
    const id2 = generateRequestId();

    // Extract counter part (last segment after -)
    const counter1 = parseInt(id1.split('-').pop()!);
    const counter2 = parseInt(id2.split('-').pop()!);

    expect(counter2).toBe(counter1 + 1);
  });
});

describe('round-trip encoding/decoding', () => {
  test('JSON round-trip preserves data', () => {
    const original = {
      cmd: 'PUSH',
      queue: 'test-queue',
      data: {
        complex: { nested: true },
        array: [1, 'two', null],
        number: 42.5,
      },
    };

    const encoded = encodeCommand(original, 'r99', false);
    const decoded = JSON.parse(encoded.toString().trim());

    expect(decoded.cmd).toBe(original.cmd);
    expect(decoded.queue).toBe(original.queue);
    expect(decoded.data).toEqual(original.data);
    expect(decoded.reqId).toBe('r99');
  });

  test('binary round-trip preserves data', () => {
    const original = {
      cmd: 'PUSH',
      queue: 'test-queue',
      data: {
        buffer: Buffer.from([1, 2, 3]).toString('base64'),
        nested: { deep: { value: true } },
      },
    };

    const encoded = encodeCommand(original, 'r100', true);

    // Simulate what the handler does
    const handler = new BinaryBufferHandler();
    handler.append(encoded);
    const frames = handler.extractFrames();

    expect(frames).toHaveLength(1);
    expect(frames[0].cmd).toBe(original.cmd);
    expect(frames[0].queue).toBe(original.queue);
    expect(frames[0].data).toEqual(original.data);
    expect(frames[0].reqId).toBe('r100');
  });
});
