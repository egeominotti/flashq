"""
Example 17: Benchmark - Measure throughput

Demonstrates high-performance batch operations.
"""

import asyncio
import time
from flashq import FlashQ, Worker


JOBS = 10_000
BATCH = 1000


async def main():
    async with FlashQ() as client:
        await client.obliterate("benchmark")

        # Push in batches
        print(f"Pushing {JOBS:,} jobs...")
        push_start = time.time()

        for i in range(0, JOBS, BATCH):
            batch_size = min(BATCH, JOBS - i)
            jobs = [{"data": {"i": i + j}} for j in range(batch_size)]
            await client.push_batch("benchmark", jobs)

        push_time = time.time() - push_start
        print(f"Push: {int(JOBS / push_time):,} jobs/sec")

        # Process
        processed = 0
        process_start = time.time()

        worker = Worker(
            "benchmark",
            lambda job: {"ok": True},
            worker_options={"concurrency": 20, "auto_start": False},
        )

        def on_completed(job, result):
            nonlocal processed
            processed += 1

        worker.on("completed", on_completed)
        await worker.start()

        # Wait for all jobs
        while processed < JOBS:
            await asyncio.sleep(0.1)

        process_time = time.time() - process_start
        print(f"Process: {int(processed / process_time):,} jobs/sec")
        print(f"Total: {processed:,} jobs")

        await worker.stop()
        await client.obliterate("benchmark")


if __name__ == "__main__":
    asyncio.run(main())
