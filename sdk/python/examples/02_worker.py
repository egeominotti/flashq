#!/usr/bin/env python3
"""
FlashQ Python SDK - Worker Example

Demonstrates how to create workers that process jobs from queues.

Usage:
    python examples/02_worker.py

Requirements:
    - FlashQ server running on localhost:6789
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from flashq import FlashQ, Worker, WorkerPool


async def main():
    print("FlashQ Worker Example")
    print("=" * 40)

    # First, push some jobs to process
    async with FlashQ() as client:
        for i in range(5):
            await client.push("demo-queue", {"task_id": i, "message": f"Task {i}"})
        print("Pushed 5 jobs to demo-queue")

    # Example 1: Simple worker with decorator
    print("\n[Worker with Decorator]")

    worker = Worker("demo-queue", concurrency=2)
    jobs_processed = []

    @worker.process
    async def handle_job(job):
        print(f"  Processing job {job.id}: {job.data}")
        jobs_processed.append(job.id)
        await asyncio.sleep(0.1)  # Simulate work
        return {"processed": True}

    # Run worker for a short time
    async def run_with_timeout():
        task = asyncio.create_task(worker.run())
        await asyncio.sleep(2)  # Process for 2 seconds
        await worker.stop()
        try:
            await task
        except asyncio.CancelledError:
            pass

    await run_with_timeout()
    print(f"Processed {len(jobs_processed)} jobs")

    # Example 2: Worker with queue-specific handlers
    print("\n[Worker with Multiple Handlers]")

    async with FlashQ() as client:
        await client.push("emails", {"to": "a@test.com"})
        await client.push("sms", {"phone": "123456"})

    worker2 = Worker("emails", "sms", concurrency=1)

    @worker2.process(queue="emails")
    async def handle_email(job):
        print(f"  Sending email to {job.data['to']}")
        return {"sent": True}

    @worker2.process(queue="sms")
    async def handle_sms(job):
        print(f"  Sending SMS to {job.data['phone']}")
        return {"sent": True}

    async def run_worker2():
        task = asyncio.create_task(worker2.run())
        await asyncio.sleep(2)
        await worker2.stop()
        try:
            await task
        except asyncio.CancelledError:
            pass

    await run_worker2()

    # Example 3: WorkerPool for multiple queues
    print("\n[WorkerPool]")

    async with FlashQ() as client:
        await client.push("pool-queue-1", {"n": 1})
        await client.push("pool-queue-2", {"n": 2})

    async def handler1(job):
        print(f"  Pool handler 1: {job.data}")
        return {"ok": True}

    async def handler2(job):
        print(f"  Pool handler 2: {job.data}")
        return {"ok": True}

    pool = WorkerPool(host="localhost", port=6789)
    pool.add_worker("pool-queue-1", handler=handler1, concurrency=1)
    pool.add_worker("pool-queue-2", handler=handler2, concurrency=1)

    async def run_pool():
        task = asyncio.create_task(pool.run())
        await asyncio.sleep(2)
        await pool.stop()
        try:
            await task
        except asyncio.CancelledError:
            pass

    await run_pool()

    print("\nWorker examples complete!")


if __name__ == "__main__":
    asyncio.run(main())
