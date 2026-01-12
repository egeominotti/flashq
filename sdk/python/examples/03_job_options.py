#!/usr/bin/env python3
"""
FlashQ Python SDK - Job Options Example

Demonstrates all available job options: priority, delay, TTL, timeout,
max_attempts, backoff, unique_key, depends_on, tags.

Usage:
    python examples/03_job_options.py

Requirements:
    - FlashQ server running on localhost:6789
"""
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from flashq import FlashQ, PushOptions


async def main():
    print("FlashQ Job Options Example")
    print("=" * 50)

    async with FlashQ() as client:
        # 1. Priority - higher priority jobs are processed first
        print("\n[1. Priority]")
        low = await client.push("priority-test", {"level": "low"}, PushOptions(priority=1))
        high = await client.push("priority-test", {"level": "high"}, PushOptions(priority=100))
        urgent = await client.push("priority-test", {"level": "urgent"}, PushOptions(priority=1000))
        print(f"  Low priority job: {low.id} (priority=1)")
        print(f"  High priority job: {high.id} (priority=100)")
        print(f"  Urgent job: {urgent.id} (priority=1000)")

        # Pull - should get urgent first
        job = await client.pull("priority-test")
        print(f"  First pulled: {job.data['level']} (expected: urgent)")
        await client.ack(job.id)

        # 2. Delay - schedule job for future execution
        print("\n[2. Delay]")
        delayed = await client.push("delay-test", {"scheduled": True}, PushOptions(
            delay=5000  # 5 seconds delay
        ))
        state = await client.get_state(delayed.id)
        print(f"  Delayed job {delayed.id} state: {state}")
        print("  Job will be available in 5 seconds")

        # 3. TTL - job expires if not processed in time
        print("\n[3. TTL (Time-To-Live)]")
        expiring = await client.push("ttl-test", {"expires": True}, PushOptions(
            ttl=60000  # Expires in 60 seconds
        ))
        print(f"  Job {expiring.id} will expire in 60 seconds if not processed")

        # 4. Timeout - max processing time
        print("\n[4. Timeout]")
        timed = await client.push("timeout-test", {"max_time": "30s"}, PushOptions(
            timeout=30000  # 30 second processing timeout
        ))
        print(f"  Job {timed.id} has 30 second processing timeout")

        # 5. Max Attempts & Backoff - retry configuration
        print("\n[5. Max Attempts & Backoff]")
        retryable = await client.push("retry-test", {"retries": True}, PushOptions(
            max_attempts=5,  # Retry up to 5 times
            backoff=1000     # 1s, 2s, 4s, 8s exponential backoff
        ))
        print(f"  Job {retryable.id}: max 5 attempts with exponential backoff")
        print("  Delays: 1s -> 2s -> 4s -> 8s -> 16s")

        # 6. Unique Key - job deduplication
        print("\n[6. Unique Key (Deduplication)]")
        unique_key = f"report-{int(time.time())}"
        job1 = await client.push("unique-test", {"report": 1}, PushOptions(
            unique_key=unique_key
        ))
        print(f"  First job with key '{unique_key}': {job1.id}")

        try:
            job2 = await client.push("unique-test", {"report": 2}, PushOptions(
                unique_key=unique_key
            ))
            print(f"  Second job (deduplicated): {job2.id}")
        except Exception as e:
            print(f"  Duplicate rejected: {e}")

        # 7. Dependencies - job depends on other jobs
        print("\n[7. Job Dependencies]")
        parent1 = await client.push("deps-test", {"step": "fetch_data"})
        parent2 = await client.push("deps-test", {"step": "transform_data"})
        child = await client.push("deps-test", {"step": "aggregate"}, PushOptions(
            depends_on=[parent1.id, parent2.id]
        ))
        child_state = await client.get_state(child.id)
        print(f"  Parent jobs: {parent1.id}, {parent2.id}")
        print(f"  Child job {child.id} state: {child_state}")
        print("  Child waits until parents complete")

        # 8. Tags - categorize and filter jobs
        print("\n[8. Tags]")
        tagged = await client.push("tags-test", {"data": "important"}, PushOptions(
            tags=["important", "customer:123", "region:us-east"]
        ))
        print(f"  Job {tagged.id} tagged with: important, customer:123, region:us-east")

        # 9. Combined options
        print("\n[9. Combined Options]")
        complex_job = await client.push("complex-test", {
            "action": "generate_report",
            "customer_id": 12345
        }, PushOptions(
            priority=50,
            delay=1000,
            ttl=3600000,       # 1 hour
            timeout=300000,    # 5 minutes
            max_attempts=3,
            backoff=5000,
            unique_key="report-12345",
            tags=["reports", "customer:12345"]
        ))
        print(f"  Complex job {complex_job.id} created with all options")

        # Cleanup - pull and ack remaining test jobs
        for queue in ["priority-test", "delay-test", "ttl-test", "timeout-test",
                      "retry-test", "unique-test", "deps-test", "tags-test", "complex-test"]:
            try:
                while True:
                    job = await asyncio.wait_for(client.pull(queue), timeout=0.5)
                    await client.ack(job.id)
            except asyncio.TimeoutError:
                pass

    print("\nJob options example complete!")


if __name__ == "__main__":
    asyncio.run(main())
