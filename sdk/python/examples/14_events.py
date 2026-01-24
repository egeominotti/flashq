"""
Example 14: Worker Events - completed, failed, error

Demonstrates event handling in workers.
"""

import asyncio
from flashq import FlashQ, Worker, Queue


async def process_job(job):
    if job.data.get("should_fail"):
        raise Exception("Intentional failure")
    return {"processed": True}


async def main():
    async with FlashQ() as client:
        # Worker with event handlers
        worker = Worker(
            "jobs",
            process_job,
            worker_options={"concurrency": 5, "auto_start": False},
        )

        # Event listeners
        worker.on("completed", lambda job, result: print(f"Job {job.id} completed: {result}"))
        worker.on("failed", lambda job, error: print(f"Job {job.id} failed: {error}"))
        worker.on("error", lambda error: print(f"Worker error: {error}"))

        await worker.start()

        # Add jobs
        await client.push("jobs", {"value": 1})
        await client.push("jobs", {"value": 2})
        await client.push("jobs", {"should_fail": True})

        await asyncio.sleep(2)
        await worker.stop()


if __name__ == "__main__":
    asyncio.run(main())
