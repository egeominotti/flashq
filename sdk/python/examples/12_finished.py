"""
Example 12: Wait for Job Completion

Demonstrates the finished() method for synchronous workflows.
"""

import asyncio
from flashq import FlashQ, Worker, Job


async def process_task(job: Job[dict]) -> dict:
    """Process a task and return result."""
    await asyncio.sleep(0.5)  # Simulate work
    return {
        "processed": True,
        "input": job.data,
        "output": job.data.get("value", 0) * 2,
    }


async def main():
    # Start a worker in the background
    worker = Worker(
        "sync-tasks",
        process_task,
        worker_options={"auto_start": False},
    )
    await worker.start()

    async with FlashQ() as client:
        # Push a job
        job_id = await client.push("sync-tasks", {"value": 42})
        print(f"Pushed job: {job_id}")

        # Wait for completion (synchronous workflow)
        print("Waiting for job to complete...")
        result = await client.finished(job_id, timeout=10000)
        print(f"Job result: {result}")

    await worker.stop()


if __name__ == "__main__":
    asyncio.run(main())
