"""
Example 22: Group Support - FIFO processing within groups

Jobs with the same group_id are processed sequentially (one at a time),
while different groups can be processed in parallel.

Use case: Process all orders for a customer in sequence while allowing
orders from different customers to be processed in parallel.
"""

import asyncio
from flashq import FlashQ, PushOptions


async def main():
    async with FlashQ() as client:
        print("=== Group Support Example ===\n")

        # Clean up from previous runs
        await client.drain("orders")

        # Push multiple orders for customer A (same group)
        print("Pushing orders for Customer A (same group - processed sequentially)...")
        customer_a1 = await client.push(
            "orders",
            {"customer": "A", "order": 1},
            PushOptions(group_id="customer-A"),
        )
        customer_a2 = await client.push(
            "orders",
            {"customer": "A", "order": 2},
            PushOptions(group_id="customer-A"),
        )
        customer_a3 = await client.push(
            "orders",
            {"customer": "A", "order": 3},
            PushOptions(group_id="customer-A"),
        )

        # Push orders for customer B (different group)
        print("Pushing orders for Customer B (different group - can run in parallel)...")
        customer_b1 = await client.push(
            "orders",
            {"customer": "B", "order": 1},
            PushOptions(group_id="customer-B"),
        )
        customer_b2 = await client.push(
            "orders",
            {"customer": "B", "order": 2},
            PushOptions(group_id="customer-B"),
        )

        print(f"\nPushed jobs: A1={customer_a1}, A2={customer_a2}, A3={customer_a3}, B1={customer_b1}, B2={customer_b2}")

        # Simulate a worker pulling and processing jobs
        print("\n--- Simulating Worker Processing ---\n")

        # First pull - should get one job from each group
        job1 = await client.pull("orders")
        job2 = await client.pull("orders")
        if job1 and job2:
            print(
                f"First batch pulled: Job {job1.id} ({job1.data['customer']}-{job1.data['order']}), "
                f"Job {job2.id} ({job2.data['customer']}-{job2.data['order']})"
            )

        # Ack the first job and see that we can pull the next one from that group
        if job1:
            print(f"\nAcking Job {job1.id} ({job1.data['customer']}-{job1.data['order']})...")
            await client.ack(job1.id)

            # Now we should be able to pull the next job from that customer's group
            job3 = await client.pull("orders")
            if job3:
                print(f"After ack, pulled: Job {job3.id} ({job3.data['customer']}-{job3.data['order']})")
                await client.ack(job3.id)

        # Ack remaining jobs
        if job2:
            await client.ack(job2.id)

        # Pull and ack remaining jobs
        remaining = await client.pull("orders")
        while remaining and remaining.id > 0:
            print(f"Processing remaining: Job {remaining.id} ({remaining.data['customer']}-{remaining.data['order']})")
            await client.ack(remaining.id)
            remaining = await client.pull("orders")

        print("\n=== Group Support Benefits ===")
        print("1. Jobs within a group are processed in FIFO order")
        print("2. Different groups can be processed in parallel")
        print("3. Perfect for per-user, per-tenant, or per-resource processing")
        print("4. Ensures data consistency for related operations")

        print("\nDone!")


if __name__ == "__main__":
    asyncio.run(main())
