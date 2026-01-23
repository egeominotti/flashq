"""
Example 09: Rate Limiting

Demonstrates queue rate limiting.
"""

import asyncio
import time
from flashq import FlashQ


async def main():
    async with FlashQ() as client:
        # Set rate limit: 5 jobs per second
        await client.set_rate_limit("rate-limited", 5)
        print("Set rate limit: 5 jobs/sec")

        # Push 20 jobs
        for i in range(20):
            await client.push("rate-limited", {"index": i})
        print("Pushed 20 jobs")

        # Pull and time how fast we can process
        start = time.perf_counter()
        count = 0

        for _ in range(20):
            job = await client.pull("rate-limited", timeout=5000)
            if job:
                await client.ack(job.id)
                count += 1

        elapsed = time.perf_counter() - start
        print(f"Processed {count} jobs in {elapsed:.2f}s")
        print(f"Rate: {count / elapsed:.1f} jobs/sec (limited to 5)")

        # Clear rate limit
        await client.clear_rate_limit("rate-limited")
        print("Rate limit cleared")


if __name__ == "__main__":
    asyncio.run(main())
