"""
Example 01: Basic Usage

Demonstrates basic push, pull, and ack operations.
"""

import asyncio
from flashq import FlashQ


async def main():
    # Create client and connect
    async with FlashQ() as client:
        # Push a job
        job_id = await client.push("emails", {
            "to": "user@example.com",
            "subject": "Hello",
            "body": "Welcome to flashQ!",
        })
        print(f"Pushed job: {job_id}")

        # Pull the job
        job = await client.pull("emails")
        if job:
            print(f"Pulled job: {job.id}")
            print(f"Data: {job.data}")

            # Acknowledge completion
            await client.ack(job.id, {"sent": True})
            print("Job completed!")


if __name__ == "__main__":
    asyncio.run(main())
