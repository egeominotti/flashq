#!/usr/bin/env python3
"""
FlashQ Python SDK - Queue Control Example

Demonstrates queue management: pause, resume, rate limiting, concurrency.

Usage:
    python examples/08_queue_control.py

Requirements:
    - FlashQ server running on localhost:6789
"""
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from flashq import FlashQ


async def main():
    print("FlashQ Queue Control Example")
    print("=" * 50)

    async with FlashQ() as client:
        # 1. List Queues
        print("\n[1. List Queues]")

        # Create some jobs to populate queues
        await client.push("queue-a", {"n": 1})
        await client.push("queue-b", {"n": 2})
        await client.push("queue-c", {"n": 3})

        queues = await client.list_queues()
        print(f"  Found {len(queues)} queues:")
        for q in queues[:5]:  # Show first 5
            print(f"  - {q.name}: {q.pending} pending, {q.processing} processing")

        # 2. Pause and Resume
        print("\n[2. Pause and Resume]")

        await client.push("pause-demo", {"before_pause": True})
        print("  Pushed job before pause")

        await client.pause("pause-demo")
        print("  Queue paused")

        # Check queue status
        queues = await client.list_queues()
        pause_queue = next((q for q in queues if q.name == "pause-demo"), None)
        if pause_queue:
            print(f"  Queue paused: {pause_queue.paused}")

        await client.push("pause-demo", {"during_pause": True})
        print("  Pushed job during pause (will be queued)")

        await client.resume("pause-demo")
        print("  Queue resumed")

        # Process jobs
        while True:
            try:
                job = await asyncio.wait_for(client.pull("pause-demo"), timeout=0.5)
                await client.ack(job.id)
            except asyncio.TimeoutError:
                break

        # 3. Rate Limiting
        print("\n[3. Rate Limiting]")

        # Set rate limit: 10 jobs per second
        await client.set_rate_limit("rate-demo", 10)
        print("  Set rate limit: 10 jobs/sec")

        # Push many jobs
        ids = await client.push_batch("rate-demo", [{"data": {"n": i}} for i in range(50)])
        print(f"  Pushed {len(ids)} jobs")

        # Pull jobs and measure rate
        start = time.perf_counter()
        pulled = 0
        while True:
            try:
                job = await asyncio.wait_for(client.pull("rate-demo"), timeout=2.0)
                await client.ack(job.id)
                pulled += 1
                if pulled >= 20:  # Only pull 20 to demonstrate
                    break
            except asyncio.TimeoutError:
                break

        elapsed = time.perf_counter() - start
        actual_rate = pulled / elapsed if elapsed > 0 else 0
        print(f"  Pulled {pulled} jobs in {elapsed:.2f}s")
        print(f"  Actual rate: {actual_rate:.1f} jobs/sec (limited to 10)")

        # Clear rate limit
        await client.clear_rate_limit("rate-demo")
        print("  Rate limit cleared")

        # Clean up remaining
        while True:
            try:
                job = await asyncio.wait_for(client.pull("rate-demo"), timeout=0.3)
                await client.ack(job.id)
            except asyncio.TimeoutError:
                break

        # 4. Concurrency Control
        print("\n[4. Concurrency Control]")

        # Set concurrency limit: max 3 concurrent
        await client.set_concurrency("conc-demo", 3)
        print("  Set concurrency limit: 3 concurrent jobs")

        # Push jobs
        ids = await client.push_batch("conc-demo", [{"data": {"n": i}} for i in range(10)])
        print(f"  Pushed {len(ids)} jobs")

        # Pull multiple jobs concurrently
        async def process_job():
            job = await client.pull("conc-demo")
            await asyncio.sleep(0.5)  # Simulate work
            await client.ack(job.id)
            return job.id

        # Try to process 5 concurrently (should be limited to 3)
        tasks = [asyncio.create_task(process_job()) for _ in range(5)]
        done, pending = await asyncio.wait(tasks, timeout=3.0)
        print(f"  Processed {len(done)} jobs with concurrency limit")

        # Cancel pending
        for task in pending:
            task.cancel()

        # Clear concurrency limit
        await client.clear_concurrency("conc-demo")
        print("  Concurrency limit cleared")

        # Clean up
        while True:
            try:
                job = await asyncio.wait_for(client.pull("conc-demo"), timeout=0.3)
                await client.ack(job.id)
            except asyncio.TimeoutError:
                break

        # 5. Queue Stats
        print("\n[5. Queue Stats]")

        stats = await client.stats()
        print(f"  Global stats:")
        print(f"    Queued: {stats.queued}")
        print(f"    Processing: {stats.processing}")
        print(f"    Delayed: {stats.delayed}")
        print(f"    DLQ: {stats.dlq}")

        # 6. Detailed Metrics
        print("\n[6. Detailed Metrics]")

        metrics = await client.metrics()
        print(f"  Metrics:")
        print(f"    Total pushed: {metrics.total_pushed}")
        print(f"    Total completed: {metrics.total_completed}")
        print(f"    Total failed: {metrics.total_failed}")
        print(f"    Jobs/sec: {metrics.jobs_per_second:.2f}")
        print(f"    Avg latency: {metrics.avg_latency_ms:.2f}ms")

        # Cleanup
        print("\n[Cleanup]")
        for queue in ["queue-a", "queue-b", "queue-c", "pause-demo", "rate-demo", "conc-demo"]:
            while True:
                try:
                    job = await asyncio.wait_for(client.pull(queue), timeout=0.2)
                    await client.ack(job.id)
                except asyncio.TimeoutError:
                    break

    print("\nQueue control example complete!")


if __name__ == "__main__":
    asyncio.run(main())
