"""
Example 11: Unique Jobs

Demonstrates job deduplication with unique keys.
"""

import asyncio
from flashq import FlashQ, PushOptions, DuplicateJobError


async def main():
    async with FlashQ() as client:
        # Clean up from previous runs
        await client.drain("payments")

        # Push a job with unique key
        job_id = await client.push(
            "payments",
            {"orderId": "ORD-123", "amount": 100},
            PushOptions(unique_key="payment:ORD-123"),
        )
        print(f"Pushed unique job: {job_id}")

        # Try to push duplicate - should fail or return existing
        try:
            duplicate_id = await client.push(
                "payments",
                {"orderId": "ORD-123", "amount": 100},
                PushOptions(unique_key="payment:ORD-123"),
            )
            print(f"Duplicate allowed with ID: {duplicate_id}")
        except DuplicateJobError as e:
            print(f"Duplicate rejected: {e}")

        # Different unique key works
        job_id2 = await client.push(
            "payments",
            {"orderId": "ORD-456", "amount": 200},
            PushOptions(unique_key="payment:ORD-456"),
        )
        print(f"Different unique key accepted: {job_id2}")


if __name__ == "__main__":
    asyncio.run(main())
