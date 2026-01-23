"""
Example 04: Delayed Jobs

Demonstrates scheduling jobs to run in the future.
"""

import asyncio
from flashq import FlashQ, PushOptions


async def main():
    async with FlashQ() as client:
        # Push a job with 3 second delay
        job_id = await client.push(
            "notifications",
            {"message": "This was delayed!"},
            PushOptions(delay=3000),  # 3 seconds
        )
        print(f"Pushed delayed job: {job_id}")

        # Try to pull immediately - should timeout
        print("Trying to pull immediately...")
        job = await client.pull("notifications", timeout=1000)
        print(f"Immediate pull: {job}")  # Should be None

        # Wait for delay
        print("Waiting 3 seconds...")
        await asyncio.sleep(3)

        # Now pull - should succeed
        job = await client.pull("notifications", timeout=1000)
        if job:
            print(f"Pulled after delay: {job.data}")
            await client.ack(job.id)


if __name__ == "__main__":
    asyncio.run(main())
