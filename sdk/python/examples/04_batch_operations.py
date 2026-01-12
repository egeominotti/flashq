#!/usr/bin/env python3
"""
FlashQ Python SDK - Batch Operations Example

Demonstrates batch push, pull, and ack for high-throughput scenarios.

Usage:
    python examples/04_batch_operations.py

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
    print("FlashQ Batch Operations Example")
    print("=" * 50)

    async with FlashQ() as client:
        # 1. Batch Push
        print("\n[1. Batch Push]")

        # Create 100 jobs
        jobs = [{"data": {"task_id": i, "value": i * 10}} for i in range(100)]

        start = time.perf_counter()
        ids = await client.push_batch("batch-test", jobs)
        elapsed = (time.perf_counter() - start) * 1000

        print(f"  Pushed {len(ids)} jobs in {elapsed:.2f}ms")
        print(f"  First 5 IDs: {ids[:5]}")
        print(f"  Throughput: {len(ids) / (elapsed / 1000):.0f} jobs/sec")

        # 2. Batch Push with Options
        print("\n[2. Batch Push with Options]")

        jobs_with_options = [
            {"data": {"priority": "low"}, "priority": 1},
            {"data": {"priority": "medium"}, "priority": 50},
            {"data": {"priority": "high"}, "priority": 100},
            {"data": {"delayed": True}, "delay": 5000},
            {"data": {"tagged": True}, "tags": ["important"]},
        ]

        ids = await client.push_batch("batch-options", jobs_with_options)
        print(f"  Pushed {len(ids)} jobs with various options")

        # 3. Batch Pull
        print("\n[3. Batch Pull]")

        start = time.perf_counter()
        pulled_jobs = await client.pull_batch("batch-test", 50)
        elapsed = (time.perf_counter() - start) * 1000

        print(f"  Pulled {len(pulled_jobs)} jobs in {elapsed:.2f}ms")
        print(f"  First job data: {pulled_jobs[0].data if pulled_jobs else 'N/A'}")

        # 4. Batch Ack
        print("\n[4. Batch Ack]")

        job_ids = [j.id for j in pulled_jobs]

        start = time.perf_counter()
        acked = await client.ack_batch(job_ids)
        elapsed = (time.perf_counter() - start) * 1000

        print(f"  Acknowledged {len(job_ids)} jobs in {elapsed:.2f}ms")

        # 5. High-throughput scenario
        print("\n[5. High-Throughput Scenario]")

        total_jobs = 1000
        batch_size = 100

        # Push in batches
        start = time.perf_counter()
        all_ids = []
        for i in range(0, total_jobs, batch_size):
            batch = [{"data": {"n": j}} for j in range(i, min(i + batch_size, total_jobs))]
            ids = await client.push_batch("throughput-test", batch)
            all_ids.extend(ids)
        push_time = time.perf_counter() - start

        print(f"  Pushed {total_jobs} jobs in {push_time*1000:.2f}ms")
        print(f"  Push throughput: {total_jobs / push_time:.0f} jobs/sec")

        # Pull and ack in batches
        start = time.perf_counter()
        processed = 0
        while processed < total_jobs:
            jobs = await client.pull_batch("throughput-test", batch_size)
            if not jobs:
                break
            await client.ack_batch([j.id for j in jobs])
            processed += len(jobs)
        process_time = time.perf_counter() - start

        print(f"  Processed {processed} jobs in {process_time*1000:.2f}ms")
        print(f"  Process throughput: {processed / process_time:.0f} jobs/sec")

        # Cleanup remaining jobs
        print("\n[Cleanup]")
        for queue in ["batch-test", "batch-options", "throughput-test"]:
            cleaned = 0
            while True:
                try:
                    jobs = await asyncio.wait_for(
                        client.pull_batch(queue, 100),
                        timeout=0.5
                    )
                    if not jobs:
                        break
                    await client.ack_batch([j.id for j in jobs])
                    cleaned += len(jobs)
                except asyncio.TimeoutError:
                    break
            if cleaned:
                print(f"  Cleaned {cleaned} jobs from {queue}")

    print("\nBatch operations example complete!")


if __name__ == "__main__":
    asyncio.run(main())
