"""
Example 05: Batch Operations

Demonstrates batch push, pull, and ack for high throughput.
"""

import asyncio
import time
from flashq import FlashQ


async def main():
    async with FlashQ() as client:
        # Batch push 1000 jobs
        jobs = [{"index": i, "data": f"payload-{i}"} for i in range(1000)]

        start = time.perf_counter()
        result = await client.push_batch("batch-test", jobs)
        push_time = (time.perf_counter() - start) * 1000

        print(f"Pushed {len(result.job_ids)} jobs in {push_time:.2f}ms")
        print(f"Throughput: {len(result.job_ids) / (push_time / 1000):.0f} jobs/sec")

        # Batch pull
        start = time.perf_counter()
        pulled = await client.pull_batch("batch-test", 100, timeout=5000)
        pull_time = (time.perf_counter() - start) * 1000

        print(f"Pulled {len(pulled)} jobs in {pull_time:.2f}ms")

        # Batch ack
        if pulled:
            job_ids = [j.id for j in pulled]
            start = time.perf_counter()
            await client.ack_batch(job_ids)
            ack_time = (time.perf_counter() - start) * 1000

            print(f"Acked {len(job_ids)} jobs in {ack_time:.2f}ms")


if __name__ == "__main__":
    asyncio.run(main())
