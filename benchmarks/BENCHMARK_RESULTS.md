# flashQ vs BullMQ Performance Benchmark

**Date:** 2026-01-18
**Platform:** darwin arm64
**Bun Version:** 1.3.6

## Results

| Scenario | flashQ (jobs/sec) | BullMQ (jobs/sec) | Speedup |
|----------|-------------------|-------------------|---------|
| Single Push | 21,487 | 4,383 | **4.9x** |
| Batch Push | 601,389 | 42,518 | **14.1x** |
| Processing | 310,224 | 14,657 | **21.2x** |
| High Throughput | 242,293 | 14,678 | **16.5x** |
| Large Payload | 17,653 | 4,699 | **3.8x** |

## Summary

**flashQ is 12.1x faster than BullMQ on average.**

### Why flashQ is faster

1. **Rust vs Node.js** - No garbage collection pauses, zero-cost abstractions
2. **In-memory first** - Optional PostgreSQL persistence, no Redis dependency
3. **Batch operations** - Native batch push/pull/ack for high throughput
4. **32 sharded queues** - Parallel access with minimal lock contention
5. **Binary protocol** - MessagePack support for 40% smaller payloads
6. **Lock-free data structures** - DashMap for O(1) concurrent lookups

### Test Configuration

| Parameter | Value |
|-----------|-------|
| Single Push Jobs | 10,000 |
| Batch Push Jobs | 100,000 |
| Batch Size | 1000 |
| Processing Jobs | 50,000 |
| High Throughput Jobs | 50,000 |
| Concurrency | 10 workers |
| Large Payload Size | 10KB |

## How to Reproduce

```bash
# Start flashQ server
cd server && HTTP=1 cargo run --release

# Start Redis (for BullMQ)
docker run -d -p 6379:6379 redis:alpine

# Run benchmarks
cd benchmarks && bun install && bun run benchmark.ts
```
