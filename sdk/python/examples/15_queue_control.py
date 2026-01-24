"""
Example 15: Queue Control - Pause, Resume, Drain

Demonstrates queue management operations.
"""

import asyncio
from flashq import FlashQ, Worker, Queue


async def main():
    async with Queue("controlled") as queue:
        # Add jobs
        for i in range(5):
            await queue.add("task", {"i": i})
        print("Added 5 jobs")

        # Pause queue
        await queue.pause()
        print(f"Queue paused: {await queue.is_paused()}")

        # Worker won't process while paused
        worker = Worker(
            "controlled",
            lambda job: print(f"Processing: {job.data['i']}") or {"done": True},
            worker_options={"concurrency": 1, "auto_start": False},
        )
        await worker.start()

        await asyncio.sleep(1)
        print("(no jobs processed while paused)")

        # Resume
        await queue.resume()
        print("Queue resumed")

        await asyncio.sleep(2)

        # Get counts
        counts = await queue.get_job_counts()
        print(f"Job counts: {counts}")

        await worker.stop()
        await queue.obliterate()  # Clean up everything


if __name__ == "__main__":
    asyncio.run(main())
