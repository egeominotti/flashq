#!/usr/bin/env python3
"""
FlashQ Python SDK - Basic Usage Example

Demonstrates basic job queue operations: push, pull, ack.

Usage:
    python examples/01_basic_usage.py

Requirements:
    - FlashQ server running on localhost:6789
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from flashq import FlashQ


async def main():
    print("FlashQ Basic Usage Example")
    print("=" * 40)

    # Method 1: Using context manager (recommended)
    async with FlashQ() as client:
        # Push a job
        job = await client.push("emails", {
            "to": "user@example.com",
            "subject": "Welcome!",
            "body": "Hello from FlashQ!"
        })
        print(f"Created job {job.id}")

        # Get stats
        stats = await client.stats()
        print(f"Queue stats - Queued: {stats.queued}, Processing: {stats.processing}")

    # Method 2: Manual connection management
    client = FlashQ(host="localhost", port=6789)
    await client.connect()

    try:
        # Push another job
        job = await client.push("notifications", {"message": "Hello!"})
        print(f"Created notification job {job.id}")

        # Pull and process the job
        pulled = await client.pull("notifications")
        print(f"Pulled job {pulled.id}: {pulled.data}")

        # Acknowledge completion
        await client.ack(pulled.id, result={"sent": True})
        print(f"Job {pulled.id} completed")

    finally:
        await client.close()

    print("\nBasic usage complete!")


if __name__ == "__main__":
    asyncio.run(main())
