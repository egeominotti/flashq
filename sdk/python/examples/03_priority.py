"""
Example 03: Priority Jobs

Demonstrates job priorities - higher priority jobs are processed first.
"""

import asyncio
from flashq import FlashQ, PushOptions


async def main():
    async with FlashQ() as client:
        # Push jobs with different priorities
        await client.push("tasks", {"task": "low"}, PushOptions(priority=1))
        await client.push("tasks", {"task": "medium"}, PushOptions(priority=5))
        await client.push("tasks", {"task": "high"}, PushOptions(priority=10))
        await client.push("tasks", {"task": "critical"}, PushOptions(priority=100))

        print("Pushed 4 jobs with different priorities")

        # Pull jobs - should come in priority order (highest first)
        for _ in range(4):
            job = await client.pull("tasks", timeout=1000)
            if job:
                print(f"Pulled: {job.data['task']} (priority: {job.priority})")
                await client.ack(job.id)


if __name__ == "__main__":
    asyncio.run(main())
