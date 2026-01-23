"""
Example 07: Progress Tracking

Demonstrates job progress updates.
"""

import asyncio
from flashq import FlashQ


async def main():
    async with FlashQ() as client:
        # Push a job
        job_id = await client.push("long-tasks", {"steps": 10})
        print(f"Pushed job: {job_id}")

        # Pull and process with progress updates
        job = await client.pull("long-tasks")
        if job:
            print(f"Processing job {job.id}...")

            total_steps = job.data.get("steps", 10)
            for step in range(1, total_steps + 1):
                await asyncio.sleep(0.2)

                progress = int((step / total_steps) * 100)
                await client.progress(job.id, progress, f"Step {step}/{total_steps}")
                print(f"  Progress: {progress}%")

            # Get final progress
            progress, message = await client.get_progress(job.id)
            print(f"Final progress: {progress}% - {message}")

            await client.ack(job.id)
            print("Job completed!")


if __name__ == "__main__":
    asyncio.run(main())
