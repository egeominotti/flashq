"""
Example 16: Concurrency - Parallel job processing

Demonstrates concurrent job processing with workers.
"""

import asyncio
from flashq import FlashQ, Worker, Queue


active = 0
max_active = 0


async def process_job(job):
    global active, max_active
    active += 1
    max_active = max(max_active, active)
    print(f"Start job {job.data['id']} (active: {active})")

    await asyncio.sleep(0.5)

    active -= 1
    print(f"Done job {job.data['id']} (active: {active})")
    return {"done": True}


async def main():
    global max_active

    async with Queue("parallel") as queue:
        # Add 10 jobs
        for i in range(1, 11):
            await queue.add("task", {"id": i})
        print("Added 10 jobs\n")

        # Worker with concurrency 3
        worker = Worker(
            "parallel",
            process_job,
            worker_options={"concurrency": 3, "auto_start": False},
        )
        await worker.start()

        await asyncio.sleep(3)

        print(f"\nMax concurrent jobs: {max_active}")

        await worker.stop()


if __name__ == "__main__":
    asyncio.run(main())
