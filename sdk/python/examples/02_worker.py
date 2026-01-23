"""
Example 02: Worker

Demonstrates job processing with the Worker class.
"""

import asyncio
from flashq import FlashQ, Worker, Job


async def process_email(job: Job[dict]) -> dict:
    """Process an email job."""
    print(f"Processing email to {job.data.get('to')}")

    # Simulate work
    await asyncio.sleep(0.1)

    return {"sent": True, "timestamp": "2024-01-01T00:00:00Z"}


async def main():
    # Push some jobs first
    async with FlashQ() as client:
        for i in range(5):
            await client.push("emails", {
                "to": f"user{i}@example.com",
                "subject": f"Email {i}",
            })
        print("Pushed 5 jobs")

    # Create and start worker
    worker = Worker(
        "emails",
        process_email,
        worker_options={"auto_start": False, "concurrency": 2},
    )

    # Register event handlers
    worker.on("ready", lambda: print("Worker ready!"))
    worker.on("completed", lambda job, result: print(f"Completed: {job.id} -> {result}"))
    worker.on("failed", lambda job, err: print(f"Failed: {job.id} -> {err}"))

    # Start and run for a bit
    await worker.start()
    await asyncio.sleep(2)
    await worker.stop()

    print(f"Processed: {worker.processed}, Failed: {worker.failed}")


if __name__ == "__main__":
    asyncio.run(main())
