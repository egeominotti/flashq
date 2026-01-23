"""
Example 10: Queue API (BullMQ-compatible)

Demonstrates the BullMQ-compatible Queue class.
"""

import asyncio
from flashq import Queue


async def main():
    # Use Queue class for BullMQ-like API
    async with Queue("orders") as queue:
        # Add jobs (BullMQ style)
        job1 = await queue.add("process", {"orderId": 1, "items": ["a", "b"]})
        job2 = await queue.add("process", {"orderId": 2, "items": ["c"]})
        print(f"Added jobs: {job1.id}, {job2.id}")

        # Add bulk
        jobs = await queue.add_bulk([
            {"name": "process", "data": {"orderId": 3}},
            {"name": "process", "data": {"orderId": 4}},
        ])
        print(f"Added bulk: {[j.id for j in jobs]}")

        # Get job counts
        counts = await queue.get_job_counts()
        print(f"Job counts: {counts}")

        # Get waiting jobs
        waiting = await queue.get_jobs("waiting")
        print(f"Waiting jobs: {len(waiting)}")

        # Pause/resume
        await queue.pause()
        print(f"Queue paused: {await queue.is_paused()}")

        await queue.resume()
        print(f"Queue paused: {await queue.is_paused()}")

        # Drain (remove waiting jobs)
        await queue.drain()
        print("Queue drained")


if __name__ == "__main__":
    asyncio.run(main())
