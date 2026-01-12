#!/usr/bin/env python3
"""
FlashQ Python SDK - Dead Letter Queue Example

Demonstrates DLQ management: failed jobs, retry, inspection.

Usage:
    python examples/06_dead_letter_queue.py

Requirements:
    - FlashQ server running on localhost:6789
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from flashq import FlashQ, PushOptions


async def main():
    print("FlashQ Dead Letter Queue Example")
    print("=" * 50)

    async with FlashQ() as client:
        # 1. Creating Failed Jobs
        print("\n[1. Creating Failed Jobs]")

        # Push jobs that will "fail"
        for i in range(5):
            job = await client.push("dlq-demo", {
                "task_id": i,
                "will_fail": True
            }, PushOptions(max_attempts=1))  # Only 1 attempt = goes to DLQ on fail

            # Pull and fail the job
            pulled = await client.pull("dlq-demo")
            await client.fail(pulled.id, f"Simulated failure for task {i}")
            print(f"  Failed job {pulled.id}")

        # 2. Inspecting the DLQ
        print("\n[2. Inspecting DLQ]")

        dlq_jobs = await client.get_dlq("dlq-demo", count=100)
        print(f"  Found {len(dlq_jobs)} jobs in DLQ")

        for job in dlq_jobs[:3]:  # Show first 3
            print(f"  - Job {job.id}: {job.data}")

        # 3. Retry Single Job
        print("\n[3. Retry Single Job]")

        if dlq_jobs:
            job_to_retry = dlq_jobs[0]
            count = await client.retry_dlq("dlq-demo", job_id=job_to_retry.id)
            print(f"  Retried job {job_to_retry.id}")

            # Pull and complete it this time
            pulled = await client.pull("dlq-demo")
            await client.ack(pulled.id)
            print(f"  Successfully processed job {pulled.id}")

        # 4. Retry All DLQ Jobs
        print("\n[4. Retry All DLQ Jobs]")

        # Check DLQ count
        dlq_jobs = await client.get_dlq("dlq-demo")
        print(f"  DLQ has {len(dlq_jobs)} jobs before retry")

        # Retry all
        count = await client.retry_dlq("dlq-demo")
        print(f"  Retried {count} jobs")

        # Process all retried jobs
        processed = 0
        while True:
            try:
                job = await asyncio.wait_for(client.pull("dlq-demo"), timeout=0.5)
                await client.ack(job.id)
                processed += 1
            except asyncio.TimeoutError:
                break

        print(f"  Successfully processed {processed} retried jobs")

        # 5. Jobs with Multiple Retries
        print("\n[5. Jobs with Multiple Retries]")

        job = await client.push("retry-demo", {
            "attempts_needed": 3
        }, PushOptions(
            max_attempts=3,
            backoff=100  # 100ms base backoff
        ))
        print(f"  Created job {job.id} with max 3 attempts")

        # Fail it twice
        for attempt in range(2):
            pulled = await client.pull("retry-demo")
            await client.fail(pulled.id, f"Attempt {attempt + 1} failed")
            print(f"  Attempt {attempt + 1}: Failed")
            await asyncio.sleep(0.2)  # Wait for retry

        # Third attempt succeeds
        pulled = await client.pull("retry-demo")
        await client.ack(pulled.id)
        print(f"  Attempt 3: Success!")

        # 6. DLQ Stats
        print("\n[6. Queue Stats with DLQ]")

        # Create some DLQ jobs
        for i in range(3):
            job = await client.push("stats-demo", {"n": i}, PushOptions(max_attempts=1))
            pulled = await client.pull("stats-demo")
            await client.fail(pulled.id, "Test failure")

        stats = await client.stats()
        print(f"  Total DLQ jobs: {stats.dlq}")

        queues = await client.list_queues()
        for q in queues:
            if q.dlq > 0:
                print(f"  Queue '{q.name}': {q.dlq} in DLQ")

        # Cleanup
        print("\n[Cleanup]")
        for queue in ["dlq-demo", "retry-demo", "stats-demo"]:
            # Clear DLQ
            dlq_jobs = await client.get_dlq(queue)
            if dlq_jobs:
                await client.retry_dlq(queue)
                while True:
                    try:
                        job = await asyncio.wait_for(client.pull(queue), timeout=0.3)
                        await client.ack(job.id)
                    except asyncio.TimeoutError:
                        break

    print("\nDead Letter Queue example complete!")


if __name__ == "__main__":
    asyncio.run(main())
