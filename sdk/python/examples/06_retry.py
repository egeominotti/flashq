"""
Example 06: Retry and DLQ

Demonstrates job retries and dead letter queue handling.
"""

import asyncio
from flashq import FlashQ, PushOptions


async def main():
    async with FlashQ() as client:
        # Push a job with max 3 attempts
        job_id = await client.push(
            "flaky-tasks",
            {"task": "might-fail"},
            PushOptions(max_attempts=3, backoff=500),
        )
        print(f"Pushed job: {job_id}")

        # Simulate failures
        for attempt in range(3):
            job = await client.pull("flaky-tasks", timeout=5000)
            if job:
                print(f"Attempt {job.attempts + 1}: Failing job {job.id}")
                await client.fail(job.id, f"Simulated failure #{attempt + 1}")

                # Wait for retry delay
                await asyncio.sleep(1)

        # Check DLQ
        dlq_jobs = await client.get_dlq("flaky-tasks")
        print(f"Jobs in DLQ: {len(dlq_jobs)}")

        for job in dlq_jobs:
            print(f"  - Job {job.id}: {job.error}")

        # Retry from DLQ
        if dlq_jobs:
            count = await client.retry_dlq("flaky-tasks")
            print(f"Retried {count} jobs from DLQ")


if __name__ == "__main__":
    asyncio.run(main())
