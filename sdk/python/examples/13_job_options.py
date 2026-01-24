"""
Example 13: Job Options - Priority, Delay, Retry

Demonstrates all available job options.
"""

import asyncio
from flashq import FlashQ, Worker, PushOptions


async def main():
    async with FlashQ() as client:
        # Job with all options
        job_id = await client.push(
            "tasks",
            {"data": "important"},
            PushOptions(
                priority=10,              # Higher = first
                delay=1000,               # Run after 1s
                max_attempts=3,           # Retry 3 times
                backoff=1000,             # Exponential backoff base
                timeout=30000,            # 30s timeout
                job_id="unique-task-1",   # Custom ID for idempotency
                tags=["urgent", "batch"],
            ),
        )
        print(f"Job added with options: {job_id}")

        # Worker
        worker = Worker(
            "tasks",
            lambda job: {"done": True},
            worker_options={"concurrency": 1, "auto_start": False},
        )
        await worker.start()

        worker.on("completed", lambda job, result: print(f"Processed: {job.data}"))

        await asyncio.sleep(3)
        await worker.stop()


if __name__ == "__main__":
    asyncio.run(main())
